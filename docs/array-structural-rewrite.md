# Standalone Array structural rewrite

The implementation and its tests are at `45d3c0162ba346cf2e7784e89015d67c9a76596a`. Against the plan commit `33d7fa89320b2b61f955aab7008c428db305ff21`, all 59 production files total **18,031 lines, down from 18,128**. Eleven source files changed, with 850 lines added and 947 removed. The comparison includes the new history and ownership work and all storage specializations.

| Review input | Git identity |
| --- | --- |
| Baseline source, shared with standalone baseline `d6e668c` | `d4f5805e887b53b527700c496fe50217e5b9bcd9` |
| Previous pilot used for comparison and test recovery | `c8dd246b` |
| Candidate source tree | `e1db5975acb43d7821dcae5a94d29f3cff506cb4` |
| Candidate test tree, including the independent reference | `d44913e32cdd956f930a99512215177c82750139` |

The starting checkout was clean. Its production tree and three test blob IDs match the retrospective's recorded 7,114-test run. Before editing production, the recovered reference and focused regressions passed 135 tests on the baseline. The excluded-child probe reproduced 18 retained operands with only a point held. All 18 independent snapshot controls kept their child. Both historical lookup shapes failed the strict work check. The reverse count-three run reproduced 3,099,031 width visits on the baseline and the previous pilot. The method and runtime contracts used to derive expected results are in the candidate revision. [Runtime boundary](data-limitations.md) · [Method specification](array-method-specification.md) · [Work bounds](work-bounds.md) · [Structural plan](array-iteration-robustness.md) · [Recorded baseline](array-iteration-retrospective.md#verification-for-this-retrospective)

## Production decisions

| Public route and entry point | Decision shared by its callers | Machinery retired and reason for the remaining specialization |
| --- | --- | --- |
| Ready `splice!`, observational `splice` and `toSpliced`, via `prepareSpliceArguments` and `spliceArray` | One preparation selects the demanded start and count, consumes conversions once and gates Complete failure. A determined edit passes its cut to `fixedEdit`. The same coordinates select the successor and the mutating method's removed result. | Removed parallel ready and deferred argument normalization and separate ready layout construction. Native copying preserves fallible inspection order. `toSpliced` densifies holes. Only mutating splice owes the removed slots. [Splice](../src/array-splice.js) · [Fixed edits](../src/array-layout-methods.js) |
| Open splice, including its removed result, front/rear points and Unordered occurrences | `spliceCut` records the prefix width, surviving suffix width, deletion decision and failure obligations for this predecessor. `SpliceRanges`, point capture, removed-range selection and insertion rank consume these facts. A point holds a near slot, possible insertion interval and far interval in source coordinates. Count delivery can narrow the far interval before start delivery. | Removed `spliceSides`, `selectCut`, `splicePointInputs` and the separate prefix/suffix reconstruction in `spliceOrder`. The removed result and a pending Complete result can still owe children a point has excluded. Each releases its own data. [Splice](../src/array-splice.js) · [Collection controls](../test/fixtures/array-excluded-point.mjs) |
| `fill` and `copyWithin`, via `prepareInterval` and `intervalMethod` | `intervalRange` produces the destination, old source, effective count and fill payload. Ready and selected layout writes consume that range in `overwriteLayout`. Each overlapping copy reads the pre-write version. `finishLayout` owns capacity and write publication for a determined layout. | Removed separate ready fill/copy routines, overlapping range calculations and the layout-method dispatcher. A small patch captures just its source slots and tests destination presence until a write is established. With 64, 128 and 256 one-slot writes, fill costs five placement visits per write and copy costs six on both revisions. [Intervals](../src/array-interval.js) · [Range work](../test/fixtures/array-range-work.js) |
| `slice`, including independently delivered and opposing bounds | `selectedSlice` consumes the first available bound from its own end. `selectEdge` restricts the candidate immediately. The second bound still refers to the original length. With opposing bounds, `intersectSlice` also knows the fixed run already guaranteed from the other end. | Removed `sliceCandidates` and its padded candidate operands. `sliceChange` subscribes to numeric facts independently of contents so a surviving length reader can release a discarded slice. Ready physical views retain the bounded slice fast path. [Intervals](../src/array-interval.js) · [Sequence lifetimes](../test/fixtures/array-sequence-lifetimes.mjs) |
| `push`, `pop`, `shift`, `unshift`, `with`, `reverse` and `toReversed` | Determined edits share `fixedEdit`, interval replacement or fixed reversal. Open endpoint additions join captured ranges, removals drop one edge, and reversal changes orientation. All use the same width, edge and capacity decisions as splice. | Removed `copyFixedRanges`, the parallel fixed layout dispatcher and separate take/drop walks. Endpoint borrowing avoids visiting an unchanged prefix. Push and unshift owe a length, pop and shift owe an element, reversal tests actual end writes, and the copying methods apply their dense rules. [Dispatch](../src/array-methods.js) · [Endpoint operations](../src/array-layout-methods.js) |
| `concat`, point reads, bounded ranges and superseding owners | `concatenate` classifies each input, then uses the common join. `sequencePoint` walks joins and capacity for both a read and an independently retained capture. `selectEdge` takes or drops from either end, sharing fixed span restriction, pending projection and split work. | Removed duplicate join walking at point capture, `cropSequence`, `trimmedSequence`, `boundedSequence` and their separate split routines. A selected side has its own protection. Capacity clipping retains the producer's displaced-slot flags. [Sequences](../src/array-sequence.js) · [Region ownership](../test/fixtures/array-region-memory.mjs) |
| Length, search, Error queries, insertion ranks and bounded cursors | `useExtent` installs a single width on each structural output. Region publication, view length, open append and occurrence thresholds use it. `guaranteedOldWindow` maps a guaranteed source interval for occurrence and Error traversal. `possibleOldBounds` maps the wider range needed by initial and refined ranks. | Removed the second sequence/region refinement and notification chain, coordinate-extent copies, and duplicate forward bounds. Each cursor still owns its credit, traversal position and metadata. Guaranteed membership can precede an exact rank, and equal payloads at two positions keep distinct occurrence identities. [Regions](../src/array-region.js) · [Occurrences](../src/array-occurrences.js) · [Ranks](../src/array-insertion-ranks.js) |

## Divergent checkpoints

- **Rear point with an open predecessor.** On `[A,B,C]`, issue `splice!(2,p)`, then `toSpliced(s,k).at(-1)`. At `s=1, k=3`, either possible predecessor leaves the same final prefix ending in A. The new mapping addresses the end of the retained prefix even when deletion clips. The regression checks early-only, fresh-only and combined readers, both delivery orders and all three modes. Both streams deliver A. Complete waits on its failure gate. In a separate replay the plan commit, the saved pilot `c8dd246b` and the candidate each delivered all 16 streaming observations of this program while p was held. The reported 60 delayed reads concern an earlier trial. The saved pilot preserved the baseline's early reads on the 6,400-point splice grid and added 62. [Public reference](../test/array-splice-reference.test.js) · [Differential](../test/experiments/array-held-points.mjs)
- **Failed start after count-first delivery.** A failed start can mark surviving slots. An early implementation also returned that failure at a rear coordinate outside a shortened result. The shared flagging path now tests membership before publishing the marker. With `splice!(badStart,0,Y)` on `[C]`, Sequential's zero slot holds the exact start Error until repair, Unordered's holds C, and both direct results report the start failure. [Failure and repair witnesses](../test/array-splice-reference.test.js)
- **Opposing slice bounds.** After `[A,B,C,D,E].splice!(4,p)`, the slice from −3 to 3 ends in C under either possible length. Dropping the original opposite edge delayed the rear reader when the start arrived first. Capturing the guaranteed part of that edge delivers C under either order while p remains open. [Opposing-bound witness](../test/array-splice-reference.test.js)
- **Absence before a point's source settles.** After `[A,B,C].splice!(0,p)`, a slice from −2 to −1 has at most one element for every p. A previously issued `at(-2)` remained pending even after both bounds arrived. The same loss of progress affected a splice deleting the entire predecessor and inserting X. A rear read now consumes the captured width's exclusion evidence alongside its possible placement. The new regression checks the outstanding reader before issuing the fresh one. Reversing the failed-start example also exercises the distinction between an absent point and a surviving structural Error through forward lookup. [Public witnesses](../test/array-splice-reference.test.js)
- **Scope failure and dependent writes.** Capture `a=[2,1]` in a record with `tag=0`, issue Complete `a.splice!(1,count,X)`, then pull an item and issue writes to `a[0]` and `tag`. Before count rejection the earlier capture returns `[2,1]`. The body stays blocked. On rejection the direct result and failed pull carry the supplied cause. After exact repair and a push, a record scope yields `{a:[2,1,3],tag:0}`. With an Array scope, the tag write completes while count is held and the final tag is 7. The test also runs the invalid-comparator case and checks a faulty reference that replays the suppressed write. [Scope and model checks](../test/array-splice-reference.test.js)
- **Released contents with live numeric work.** Combining slice selection and its width subscription in one closure kept a discarded source alive. Retaining the receiver in a local binding around fallible descriptor capture also kept it reachable through an unformatted Error stack. The candidate uses a numeric-only slice signal and reads the receiver through clearable operation work. All 36 point-only and live-snapshot concat/splice cases pass, including a join feeding splice and a subsequent mutation of Y by another owner. Regional, sequence, placement-capture and failed-copy fixtures check the other owners. [Point ownership](../test/fixtures/array-excluded-point.mjs) · [Failed placement captures](../test/fixtures/placement-capture-failure-retention.mjs)

The held-input comparison checks each delivered healthy point against native completions before resolving the predecessor. Across 6,400 splice points and 5,120 slice points the candidate retains every baseline early answer and delivers an additional 154 and 40 respectively. The resulting early totals are 4,322 and 4,648. Varying the upstream cut and length across 1,600 more programs (seed 20261128) covers 27,282 points. This exposed 116 delayed rear absences on the intervening candidate. The corrected run delivers 21,238 early answers, 501 more than the baseline, with zero previously determined answers delayed. A separate 2,160 failure observations check held results against each permitted predecessor and final results against the selected outcome, including exact causes. [Differential](../test/experiments/array-held-points.mjs)

## Work and storage

### Reverse shrinking history with zero point readers

Each step appends two values, issues `splice!(1,p)` and captures length. Every p resolves to three in reverse order on a separate event-loop turn. The two scalar answers per step match a native issuance-order trace. Each mutating splice also owes its removed result. The final export has one slot. The measurements count the same width implementation's root and threshold visits on both revisions.

| Edits | Issuance, baseline → candidate | Settlement, baseline → candidate | Export | Release | Peak live width records |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 120 | 28,001 → 25,957 | 211,195 → 25,776 | 2 → 4 | 0 → 0 | 1,834 → 1,676 |
| 240 | 56,081 → 51,997 | 798,810 → 53,891 | 2 → 4 | 0 → 0 | 3,674 → 3,356 |
| 480 | 112,241 → 104,077 | 3,099,029 → 112,149 | 2 → 4 | 0 → 0 | 7,354 → 6,716 |

The costly step was summing the variable retained part and the neighboring fringe as if their widths could vary independently. They share a cut. `selectEdge` passes their joint width as one projection of the near operand when it rejoins them. At 480 edits this eliminates 153,280 reader notifications and 76,959 dispatches, with **112,153 visits through settlement and export**, a 96.4% reduction. Both versions reached 4,801 live exact-width receipts and 1,919 threshold questions. The baseline also reached 638 full-width readers. The candidate needed zero. All three record counts returned to zero. A five-edit held-first control delivers the last length of one while its immediate predecessor is still indeterminate. [Width probe](../test/experiments/array-shrinking-history.mjs) · [Held control](../test/fixtures/array-pending-history.mjs)

### Retained historical lookups

Each historical point has its own captured version. A contiguous suffix uses its anchored end, captured width and failure evidence. Across edits at both ends, equal final lengths can select different old occurrences. The mixed path shares unanswered front/rear coordinates at each pending decision and skips resolved decisions by compressing the predecessor chain. For the tested 15 rotating indexes this bounds the distinct coordinate questions per cut. Width thresholds merge in power-of-two runs, so a threshold crosses at most logarithmically many run sizes. Determined layout lookups descend balanced spans. The workload owes H distinct point answers and exports H+3 slots.

| Reverse delivery, H = 120 / 240 / 480 | Suffix history | Mixed history |
| --- | --- | --- |
| Baseline settlement point visits | 13,375 / 55,555 / 226,315 | 37,008 / 154,656 / 631,872 |
| Candidate settlement point visits | 1 / 1 / 1 | 10,530 / 22,418 / 46,194 |
| Candidate point visits, all phases | 121 / 241 / 481 | 11,010 / 23,378 / 48,114 |
| Candidate width visits, all phases | 50,438 / 101,230 / 202,814 | 118,261 / 243,005 / 492,493 |
| Candidate structural visits and allocations, all phases | 13,162 / 27,738 / 58,348 | 30,886 / 65,040 / 134,534 |
| Peak simultaneously shared point entries | 0 / 0 / 0 | 1,497 / 3,177 / 6,537 |

The candidate table uses one turn per count and omits optional length queries. The strict fixture independently varies explicit length queries and delivery order. Controls without point readers register zero point visits. Muting only the suffix receipt fails at the first active suffix sample. Muting only the indexed receipt fails at the first active mixed sample. When the contiguous-suffix shortcut was removed in a trial, suffix settlement rose to 25,360 / 108,220 / 446,740 visits and peak point entries to 3,313 / 13,813 / 56,413. That trial establishes why the two lookup cases need different origin evidence. [Point and width measurements](../test/fixtures/array-pending-history.mjs) · [Work target](array-iteration-robustness.md#work-through-a-history-of-edits)

### Ready and deferred storage

On 160 growing dense scalar append/middle-delete pairs, physical descriptor visits fell from 13,520 to five initial layout captures, and native buffers from 320 to zero. Persistent storage constructed 2,075 spans, 2,651 branch nodes and 479 remap outputs during issuance. Starting with an indexed receiver reduced physical visits from 13,680 to zero. Endpoint controls allocated zero native buffers on either revision. Deferred middle deletion kept six initial descriptor captures and reduced settlement from 1,272 to 160 spans and from 3,518 to 2,698 branches. Nine-sample median timings for 40 / 80 / 160 ready Complete edits were 15.3 / 21.5 / 51.6 ms on the baseline and 16.6 / 24.3 / 45.6 ms on the candidate. These are wall-clock samples on a shared host.

Physical storage with managed children has a different cost. Unconditionally sharing its spans raised established parent additions from 14,160 to 27,357 and removals from 13,999 to 27,196 on the 160-step program. The candidate uses the backing's maintained child-placement metadata to select the direct copy in that case, restoring 14,160 / 13,999. The failed-removed-buffer fault also reaches this path and fails its collection witness. [Storage measurements](../test/experiments/array-splice-work.mjs) · [Safeguards](../test/safeguards/registry.mjs)

## Verification

The independent reference checks 360 tagged partitions and 16,191 public sparse replays. Every replay checks both the direct output and the source, separates a hole from present `undefined`, and checks alias identity. The arithmetic probe checks 4,788 layouts, 29,358 splice occurrence mappings, 3,486 range mappings and 12 handoffs. The method-specification probe adds 63,264 `copyWithin` selector queries, 44,328 sparse-placement checks and 238,383 coordinate checks. The public witnesses cover all nine producer/receiver mode combinations, earlier snapshots, open issuers, skipped cursor bodies, sparse copies, bounded overflow and repair. [Reference](../test/array-splice-reference.test.js) · [Contract probe](../test/experiments/array-iteration-contract-probes.mjs) · [Method probe](../test/experiments/array-method-specification-probes.mjs)

All 15 deliberately introduced runtime faults reached a failing public witness. The intrinsic-boundary suite also injects a private defect at the concat join and requires the exact fatal cause, context and report. The first integrated run identified a stale hook at that join. Updating its anchor restored the original diagnostic test. [Safeguard registry](../test/safeguards/registry.mjs) · [Intrinsic-boundary tests](../test/array-intrinsic-boundaries.test.js)

| Merge check | Completed comparisons and coverage |
| --- | --- |
| Normal and instrumented suites | 7,129 passing in each run, with zero skips. An earlier instrumented run reached the history fixture's 15-second subprocess deadline under concurrent load. The completed instrumented run used that same deadline. |
| Full conflict matrix | Shards 0/8 through 7/8 passed all 104,040 paired cases and 936,360 replays. Each shard covered 2,890 predecessor/command triples including absent targets. The full product includes Arrays and records, both release orders, three sibling positions, three Chain policies and bare, observed and verified execution. |
| Generated Array programs | All 9,600 programs passed 86,400 policy/harness replays at 1,600 seeds. The 184 asserted coverage keys include all 16 start/count delivery pairs, 24 failed-splice combinations, four backing/control combinations and 40 conflict combinations. |
| Full publication-pair differential | 96,824 pairs and 290,472 delivery comparisons passed across 252 joint profile/delivery/operation keys. An independent model covered 63,168 pairs, including 10,490 modeled failures, six Error kinds and both child and self return identities. |
| Nested and external sequences | 9,600 programs and 28,800 replays for each fixture. All passed, covering 47 nested and 196 external coverage keys. |
| Boundary and placement histories | 51,200 active boundary histories across 128 joint keys and 128 retired-root histories across 128 joint keys. All 6,400 placement histories produced distinct checked command/schedule traces. |
| Input preparation and pending re-entry | 38,784 reception replays, all 128 joint preparation keys, and 4,800 lifetime replays. The pending-boundary suite passed 12,800 histories covering all 32 joint keys. |
| Promise-key differential | 9,600 generated programs and two fixed witnesses passed 28,806 replays across 34 coverage keys. |
| Receiving and invocation differential | 1,600 seeds, 152,000 reception/invocation histories and 153,600 joint path histories. All 1,696 joint coverage keys passed, including combinations of data delivery, key delivery, routes, shapes and placement roles. |
| Independent ownership model | 4,096 graphs, 1,048,576 four-node graphs and 15,000 seeded transitions (`0x713ad92`). The production ownership fixtures separately check live parents, pending publication, copy-on-write and retirement. |
| Touched depth, work and collection fixtures | All 14 named histories completed at 5,000 commands. Reverse-batch, reverse-with-turns, forward and interleaved delivery passed both lookup bounds and their matched controls. All 36 excluded-child/snapshot cases passed, along with region and sequence lifetime checks. |

## Reproduction

Use Node 24.14.1 and the locked dependencies. The two comparisons below read an isolated checkout of the plan commit. Supplying the pilot checkout to the same width probe reproduces its count-three result.

```powershell
git worktree add --detach ../cascada-structural-baseline 33d7fa8
node --unhandled-rejections=strict test/experiments/array-held-points.mjs --baseline=../cascada-structural-baseline
node --unhandled-rejections=strict test/experiments/array-shrinking-history.mjs ../cascada-structural-baseline
node --unhandled-rejections=strict test/experiments/array-shrinking-history.mjs --check-bound
node --unhandled-rejections=strict test/experiments/array-splice-work.mjs --check-storage
node --unhandled-rejections=strict test/experiments/array-splice-work.mjs --timing
node --unhandled-rejections=strict test/fixtures/array-range-work.js
node --unhandled-rejections=strict test/experiments/array-iteration-contract-probes.mjs
node --unhandled-rejections=strict test/experiments/array-method-specification-probes.mjs
node --unhandled-rejections=strict test/experiments/array-layout-technical-probes.mjs
```

The ordinary suite includes the public reference and faulty-model controls. The standalone history fixtures print the work for each phase after checking the answers. To challenge the public lookup instrumentation, run the pending-history fixture separately with `--mute-lookup=trailing` and `--mute-lookup=indexed`. Each intentionally fails its corresponding route assertion.

For the baseline storage comparison, restore the measuring script into the isolated worktree and run it there. The original history fixture at the plan commit already measures both failing lookup shapes. The pilot supplies the excluded-child fixture, which can also run against that worktree's original source.

```powershell
git -C ../cascada-structural-baseline restore --source=45d3c01 --worktree -- test/experiments/array-splice-work.mjs
git -C ../cascada-structural-baseline restore --source=c8dd246b --worktree -- test/fixtures/array-excluded-point.mjs
node --unhandled-rejections=strict ../cascada-structural-baseline/test/experiments/array-splice-work.mjs
node --expose-gc --unhandled-rejections=strict ../cascada-structural-baseline/test/fixtures/array-pending-history.mjs --check-lookup-bound
node --expose-gc --unhandled-rejections=strict ../cascada-structural-baseline/test/fixtures/array-excluded-point.mjs
```

Run the candidate suites and standalone fixtures from the candidate checkout.

```powershell
node --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js 'test/**/*.test.js' --reporter dot --timeout 12000
node --unhandled-rejections=strict --import ./test/trace-runtime.js ./node_modules/mocha/bin/mocha.js 'test/**/*.test.js' --reporter dot --timeout 12000
node --expose-gc --unhandled-rejections=strict test/fixtures/array-history-depth.mjs 5000
node --expose-gc --unhandled-rejections=strict test/fixtures/array-excluded-point.mjs
node --expose-gc --unhandled-rejections=strict test/fixtures/array-region-memory.mjs
node --expose-gc --unhandled-rejections=strict test/fixtures/array-sequence-lifetimes.mjs
foreach ($delivery in @('', '--spaced', '--forward', '--interleaved')) {
    $flags = @('--check-lookup-bound') + @($delivery | Where-Object { $_ })
    node --expose-gc --unhandled-rejections=strict test/fixtures/array-pending-history.mjs @flags
}
node --unhandled-rejections=strict --import ./test/trace-runtime.js test/fixtures/publication-pairs.js
node --unhandled-rejections=strict test/experiments/phase2-retirement.mjs
```

The following commands reproduce the full conflict product and the 1,600-seed runs. Each fixture checks its final state and required intermediate observations. The pending-boundary suite runs one test for each of its 12,800 histories across 32 distinct joint keys. [Harness settings and run counts](../test/README.md#scaling-generated-runs)

```powershell
$env:CASCADA_CONFLICT_MATRIX = 'full'
foreach ($part in 0..7) {
    $env:CASCADA_CONFLICT_PART = "$part/8"
    node --unhandled-rejections=strict test/fixtures/conflict-matrix.js
}
Remove-Item Env:CASCADA_CONFLICT_PART, Env:CASCADA_CONFLICT_MATRIX
$env:CASCADA_SEQUENCE_SEEDS = '1600'
foreach ($fixture in @('nested-sequences.js', 'external-sequences.js', 'boundary-histories.js',
    'preparation-sequences.js', 'placement-sequences.js', 'receiving-invocation-differential.mjs',
    'promise-key-differential.js', 'array-sequences.js')) {
    node --unhandled-rejections=strict --import ./test/trace-runtime.js "test/fixtures/$fixture"
}
node --unhandled-rejections=strict --import ./test/trace-runtime.js ./node_modules/mocha/bin/mocha.js test/pending-boundary-histories.test.js
Remove-Item Env:CASCADA_SEQUENCE_SEEDS
```

The 15 challenged runtime faults use the registry's individual public witnesses. The hooks record execution before a failed assertion can count.

```powershell
$faults = @('array-rear-read-observes-absence', 'array-cut-flags-only-surviving-slots', 'array-cut-preserves-common-width',
    'array-cut-wakes-rear-point', 'array-cut-preserves-failed-start', 'array-cut-preserves-complete-failure',
    'array-slice-preserves-opposite-edge', 'array-point-releases-other-join-side',
    'array-point-restricts-splice-suffix', 'array-copy-within-reads-predecessor',
    'array-insertion-preserves-possible-rank', 'array-insertion-preserves-guaranteed-window',
    'array-range-uses-effective-width', 'joined-point-follows-membership', 'failed-splice-releases-removed-slots')
node test/safeguards/run.mjs --skip-baseline @faults
```
