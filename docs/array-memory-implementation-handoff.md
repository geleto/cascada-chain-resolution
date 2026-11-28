# Cascada Chain Array memory implementation and review

The working tree implements the continuation, lease-ledger, settled-scalar, shared-prefix and region-retirement changes proposed against `fe6bfee96f69a99dab1ea26068f42938f7450ce8`. The historical measurements below used Node **24.14.1** on Windows x64. Appendix A preserves the original three-part patch against that commit.

Point reads through pending splice histories use the iterative selector at both ends. Known fixed scalars and ordinary rejected payloads use the shared captured slot. Delivered children and repairable flags use ordinary backing placements. Completing a requested gate releases it before outstanding width work finishes. A splice within a fixed prefix carries its source's proof that each retained occurrence appears once. The memory fixture checks head, moving middle and tail insertions, held snapshots, early payload delivery and retirement. [Array region memory tests](../test/fixtures/array-region-memory.mjs)

Splice width and start notifications can outlive their data. Streaming publications protect the selected and removed ranges independently. A Complete mutation keeps the inputs an outstanding whole-Array decision can still use. Success, failure, historical reads and later root replacement have separate lifetime checks. [Work bounds](work-bounds.md#controlled-array-work) · [Lifetime tests](../test/fixtures/array-sequence-lifetimes.mjs)

| Review workload on Node 24.14.1 | Before review fixes | With review fixes |
| --- | ---: | ---: |
| 450 held prepend snapshots, managed payloads before width | 101,475 completed gates, 248 MB | 0 completed gates, 45 MB |
| 4,000 known head reads with width pending | 9.2 MB retained | 0.4 MB retained |
| 900 moving middle insertions | 405,444 prefix slot transfers | 0 prefix slot transfers |
| 800 Sequential splices with pending starts and payloads | 39 MB at issuance | 16 MB at issuance |

The last workload starts with `["A","B","C"]` and issues 800 mutating splices. Splice number `i` inserts `i` at `i % 3` with a delete count of zero. Each start and payload has its own pending Promise. The probe measures retained heap after issuance and GC, then settles the inputs in issuance order and exports the result. Across three fresh processes per revision, median retained heap was 18.7 MB at the pinned commit, 30.7 MB with separate selectors for the prefix and suffix, and 16.3 MB with the shared selection. Median times for GC, settlement and export were 3.30 s, 0.40 s and 0.30 s, respectively.

One pending start now selects both ranges. In the 192-operation regression case, issuing the splices previously built 384 layout joins before any start settled. It now builds zero. Length and Unordered rank queries can still progress while the cut is unknown. [History tests](../test/fixtures/array-history-depth.mjs)

## Original proposal and measurements

| Change | Evidence and disposition | Primary implementation sites |
| --- | --- | --- |
| Share guarded continuation handlers | Candidate patch. Review and measure independently of array layout. | `src/internal-step.js`, `src/language-values.js` |
| Share the lease-ledger implementation | Candidate patch. One ledger per consumer, a shared getter and two bound operations per ledger. | `src/ownership.js` |
| Share healthy primitives already published by their exact producer | Candidate patch for this revision. Reduces held numeric histories when payloads arrive first. | `src/array-layout.js`, `compactLayout` |
| Share fixed-coordinate prefixes and late payload deliveries | Implemented for prepends and width-first snapshots. The rejected prototypes below explain the lifetime and topology tests. | `src/array-sequence.js`, `src/array-region.js`, `src/array-layout.js`, `src/property-versions.js` |
| Release superseded open-region work | Implemented through backing ownership. Scalar results, selected points, readers, pending effects and re-entry each retain their required work. | `publishSequence`, `ArrayRegion`, `LengthState`, `src/invocation.js` |
| Repeated searches, exports and compound edits | Profile after the common changes. Scope each additional change to the captured version, closed operation or compound method responsible for the remaining work. | `src/observations.js`, `src/array-methods.js`, `src/operation-lifecycle.js` |

The remainder records the original handoff, its acceptance criteria and its portable reproductions. Measurements labeled baseline or candidate refer to the pinned checkout or the original three-part patch.

## What the workloads retain

The review starts with one Chain holding `["A","B","C"]`, issues `splice(1, pendingCount)`, then issues 450 calls to `push(pendingValue)`. Every value has its own Promise. The count eventually resolves to one. The final array is `["A","C",0,…,449]`. The original case discards the returned lengths and retains only the current array. A separate case immediately looks up each successive array and puts it in its own Chain. In this pending-splice case each push publishes a new ArrayView at issuance, even when the caller never requests one. The k-th view has the post-splice length plus k. Its exact length can still be pending when issued. The public result of push is that length. A known-length receiver can take a different mutation path. The handoff microtask protects an escaping managed value during transfer. A required pending length or publication can outlive that window. All heap readings precede verification exports.

**The original case creates 450 views but retains only one after the handoff turn.** Weak-reference instrumentation found one live view and 450 regions while the original splice was pending. After settlement there was one of each. Keeping all 450 scalar length results gave the same view counts. With 450 explicit snapshot holders, all 450 views remained live through settlement. Clearing the holders and root allowed all tracked views and regions to be collected. The earlier review's roughly 112 MB was its saved historical comparison. Use the pinned commit as the implementation baseline.

The following controlled rerun separates uncertain length from pending elements on the pinned commit. Each cell is the median of three fresh processes. This smaller harness accounts for the small difference from the broader screen below.

| 450 elements at issuance | Pending public lengths | Baseline | Shared continuations and lease ledgers |
| --- | ---: | ---: | ---: |
| Known length, ready payloads | 0 | 0.91 MB | 0.91 MB |
| Known length, pending payloads | 0 | 4.57 MB | 3.59 MB |
| Pending splice count, ready payloads | 450 | 7.37 MB | 5.88 MB |
| Pending splice count, pending payloads | 450 | 10.27 MB | 7.92 MB |
| Pending splice count, one variadic push of 450 pending payloads | 1 | 2.95 MB | 2.13 MB |

Even with every element ready, leaving just the earlier splice count pending raised issuance from 0.91 MB to 7.37 MB. A caller can choose the variadic form when the source intends one mutation, one source context and one returned length. Separately issued pushes must preserve each intermediate length, observation and effect.

### Issuance on the pinned commit

Figures are medians of three fresh processes per cell. MB means 1,000,000 bytes of additional JavaScript heap after forced GC relative to a baseline taken in the same process after setup, one event-loop turn and GC. Inputs, V8 code and test-owned results contribute. RAM usage, allocation rate and peaks between samples require separate measurements.

| 450 iterations in Unordered mode | Baseline | Shared continuations and lease ledgers |
| --- | ---: | ---: |
| Tail `push` behind pending splice | 10.31 MB | 7.97 MB |
| `unshift` behind pending splice | 37.20 MB | 34.72 MB |
| `push` then `shift`, removed scalars retained | 22.61 MB | 17.17 MB |
| `push` then `copyWithin(0,1,2)` | 21.93 MB | 17.18 MB |
| `slice` with pending bound, copies held | 9.76 MB | 7.97 MB |
| `reverse` behind pending splice | 5.15 MB | 4.18 MB |
| Path lookup through pending child | 3.60 MB | 2.88 MB |
| Export of record with pending child | 5.07 MB | 4.10 MB |
| Assignment of pending value | 3.02 MB | 2.46 MB |
| `includes` with pending comparison and no match | 6.42 MB | 4.86 MB |

To reproduce the non-push rows, issue every call before resolving its inputs. Keep the specified results through the settled reading.

- For lookup and export, use one receiver `{child: pending({x: 7})}`. Look up `["child","x"]` or export the root 450 times. All lookups yield 7. The 450 exported root records must have distinct identities.
- For assignment, start with `{x: -1}` and assign a distinct pending integer to `x` on each call. Reverse delivery must leave `x === 449`. For search, use one receiver `[1,2,pending(3)]` and call `includes(9)` 450 times. Use `includes(1)` as the early-hit control.
- For each slice, use the same `[1,2,3]`, call `slice(1, pending(1 + i % 3))` and immediately put the result in its own Chain. The queue row uses the original open splice and pairs each pending push with a shift, keeping the removed scalar. The copyWithin row pushes the **ready** integer i, then calls `copyWithin(0,1,2)`. The earlier splice still leaves the receiver's width pending.

In the tail-push case, baseline and common-patch heaps after partial reverse delivery were 9.28 MB and 7.26 MB respectively. Both were about 1.13 MB after complete settlement with only the current root. Use explicit holders and WeakRefs to establish when a particular object can be collected. Aggregate heap measurements include cold-process overhead.

### Snapshot frequency and arrival order

450 tail pushes of distinct pending primitive inputs. A holder takes the result of a root lookup immediately. Nine holders capture every fiftieth version and 45 capture every tenth. Zero explicit holders leaves the current array in its original Chain. The earlier source snapshot for these numbers matches the pinned commit in all 56 runtime files after line-ending normalization. This table isolates the scalar patch alone.

| Explicit holders | Payloads first, baseline | Payloads first, scalar patch | Splice count first, baseline | Splice count first, scalar patch |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 1.08 MB | 1.09 MB | 1.42 MB | 1.43 MB |
| 9 | 1.53 MB | 1.22 MB | 3.28 MB | 3.27 MB |
| 45 | 2.83 MB | 1.46 MB | 10.83 MB | 10.85 MB |
| 450 | 16.98 MB | **3.93 MB** | 94.98 MB | **94.97 MB** |

Independent fresh runs on the pinned commit with all three edits measured **3.92 MB** when the payloads arrived first and **94.96 MB** when the count arrived first. After only the count arrived with all views held, the baseline already used 33.90 MB and the combined patch 32.95 MB. With only scalar length results held, the corresponding final combined-patch readings were 1.15 MB and 1.49 MB. The 450 held arrays have lengths 3 through 452. Exporting every array actually produces 102,375 elements, including the initial two surviving entries in every snapshot. The table measures the runtime before that output is constructed. Both delivery orders must still produce the same lengths, array values, poison and effects.

## Bounded changes for normal code review

**Guarded continuations.** The baseline builds separate fulfillment, rejection and guard closures. Pass the handler functions, owner and choice of guard through one small state object. Two shared functions receive fulfillment and rejection. Each subscription still has its own two entry callbacks and creates the poison-normalizing closure on fulfillment. Its entry callbacks share the `continuationStarted` fact. Keep callable-`then` access and invocation at their existing boundaries, preserving the distinction between a throw before callback entry and a defect escaping a started continuation. Preserve synchronous delivery, order of registration, poison source attribution, execution fatal checks and the independent local-owner check. A public operation still has one removable fatal rejection action while pending. The direct `thenValue` caller in `property-versions.js` queues release and ignores the extra internal callback arguments.

**Lease ledgers.** Keep acquire and release callable as bare functions. `InvocationWork` stores the detached functions, and outward delivery queues detached release. The tested class shares its getter, creates the two bound functions per instance, and allocates the value Set only on the first real lease. Acquisition deduplicates within the consumer, returns the exact input, and idempotent release clears the operation context. Fatal cleanup, graph-transition retirement and the public microtask delivery window keep their existing behavior. Preserve the existing fault-injection and subscription-count fixtures when moving the source anchors.

On the original frozen revision the two changes individually reduced the 10.34 MB push workload to 8.74 MB and 9.60 MB respectively. A 225-push heap comparison counted 27,000 additional closures and 24,075 lexical environments at baseline, versus 17,775 and 10,575 with the shared changes. Both counted 4,500 additional native Promise objects. These are counts above matching zero-operation controls. They explain why a change outside Array code benefits lookups and exports.

**Settled primitives.** In `compactLayout`, apply the conversion to stored, fixed-presence terminal layouts. A leaf qualifies only when its exact captured source version holds a published primitive and neither the captured placement nor the version carries relevant failure, discovery or pending structure. The patch checks publication, copied delivery, transition, pending presence, role and failure fields. Rebuild eligible leaves through `span` and parents through `branch`. Memoize completely converted immutable subtrees and keep a per-walk Map for partially resolved shared subtrees. Without that second memo an earlier prototype exceeded one million visits in the existing flattening fixture. A shared layout is a DAG even when its logical contents look like a simple Array.

Use the diff in Appendix A. The previously saved experiment tested `node.payloads`, a field removed before this commit. That diff can apply cleanly while its conversion never executes. Also, `promiseBacked` records provenance and can remain true after a primitive publishes. Verify behavior by counting real terminal slot visits. For 450 held snapshots and payloads first, the measured count goes from 101,475 to zero before export. Continue through ordinary version publication for pending selections, managed children, poison, and restoration states. Preserve holes and own `undefined`, signed zero, NaN, BigInt, Symbol, copy isolation and operation-local diagnostics.

## Structural design and original acceptance criteria

### 1. Fixed prefixes and payloads that arrive after the width

**Source of the repeated work.** `publishSequence` runs `compactLayout(sequence.head, ctx, true)`. `ArrayRegion.open` then enumerates `storedPlacements(head)` and transfers each slot to the new backing. At 450, `unshift`, `splice(0,0,value)` and `toSpliced(0,0,value)` each transfer 101,475 slots at issuance, or 1 + 2 + … + 450. Prepending via `[value].concat(previous)` transfers 101,025. Tail `push` does zero prefix transfers. When widths settle first with genuinely held views, the analogous expansion happens during terminal publication. The agent should count issue, each settlement wave and final export separately.

**Build on existing facilities.** `array-layout.js` owns relative spans, joins, restriction, fixed-presence state and compressed child occurrences. `ArrayView.backingVersion` gives an overlay or backing producer precedence over an implicit region placement. `ArrayBacking.visitViewPlacements` expands a backing occurrence into the live logical owner/key pairs, applying bounds and overlays. `ArrayRegion.versionAt` installs and settles a gate for a selected point. `createCopyDelivery`, `retainCopiedDelivery`, `releaseCopiedDelivery` and `refreshCopiedDelivery` already distinguish one exact producer outcome from independent placement authority. Reuse these responsibilities where their admission and release rules match. A published managed child's complete incoming relationships, including aliases and cycles, exist independently of the optional counter index. [Layout storage](../src/array-layout.js), [open regions](../src/array-region.js), [backing and view projection](../src/array-view.js), [copied versions](../src/property-versions.js)

**Suggested representation.** Keep a fixed-coordinate range of captured versions in the shared layout. Separate knowledge of its bounds, notification that a managed child is now present, and whole-region terminal publication. A scalar needs no parent edge. A newly admitted managed child or a proved poison must reach every affected live backing or index at the transition where the fact becomes known. Store changes at their natural scope and translate offsets only for affected live ranges. Preserve independently selected point versions when an overlay masks the backing. Memoize shared subtrees and release inactive listeners. Bound registrations to active ranges and independent captures. When the final width is known before an item, let that same producer become visible in the shared range on delivery. A point, length, known Error or child edge must become available when its own dependencies are ready, even while an unrelated sibling stays pending.

| Transition | Obligation |
| --- | --- |
| Construct or attach | Publish ready managed children at their exact exposed keys before any user read. Respect `borrowed.range` offsets and the source bounds. The borrowed prefix and the new suffix can have different owners. |
| Point read, writer, Error query or iterator | Capture the exact selected version. Preserve point overrides, presence, holes, identity, short-circuit progress and per-operation closure. Maintain an already built counter index incrementally. |
| Payload delivery | Handle primitive, managed child, payload Error, structural failure or hole using its original producer and source. Maintain parent links and counter projections before exposing affected work. A primitive shared across versions needs one logical payload. |
| Overwrite, removal or last owner | Remove only that interest. Detach the destination and release successful children, leases and abandoned output at their individual last use. Independently captured versions, outstanding gates and required external or publication effects keep their own authority. |
| Re-entry | Restore relationships synchronously from the authoritative captured forward state. Honor bounds, overlays, counters and exact producer generations. Stop at an already-active descendant. |
| Whole-layout completion | Only the complete sequence can call `region.publish` for the full backing. Release input access and pending resources at their correct boundaries. `fixedPayloads.finish` currently publishes to `cell.publications`, and `resumeLayout` can publish an already-complete `fixedStorage` immediately. Give the prefix a range-limited child-delivery registration. |

**Two rejected shortcuts define the design tests.** Leaving a pending prefix implicit until somebody reads it reduced older unshift memory to about 10.4 MB, but a ready managed sibling had no parent link before its first read. That experiment differed in 48 of 72 parent/ordering/holder checks despite a green ordinary suite on that revision. Reusing the full fixed-payload aggregate restored those links. A prefix-only version merely moved 101,475 slot visits into settlement for front `splice` and `toSpliced`. A more aggressive aggregate reduced earlier issuance to approximately 18.5 MB for unshift, 17.5 MB for front splice, 24.4 MB for front toSpliced and 23.1 MB for prepend-via-concat, but differed in seven of twelve last-use cases. Four `flat` witnesses also retained a read lease on the former receiver after shape and independent points were ready. Use those figures to estimate the opportunity. In a prior width-first run the same broad prototype also reached about 4.03 MB with 450 scalar histories. Its lifetime failures disqualify that implementation. Treat that number as a comparison for this input and engine.

In successful-child retention probes, a strong path in the rejected prototypes ran through a pending reaction, an aggregate's successful values, a placement and its managed value. Removing only the final backing listener can still leave a completed sibling strongly reachable. Reuse the backing owner lifecycle in `parent-placements.js:updateBackingOwners` and give selected point gates and genuine captures their own release rules. Use WeakRefs as test observers and drive logical publication and retirement from ownership transitions.

**Control for the source holder.** The earlier baseline prepend-via-concat experiment dropped a temporary input Chain without clearing its root. On the pinned commit, a direct input with no concat showed the same retained child. Explicitly clearing that holder released the child while its sibling remained pending in both cases, whether the input was constructed as a literal or via push. Attribute this result to the tested input-holder lifetime. The prefix prototype's unshift/toSpliced regression reproduced after its roots were explicitly cleared.

**Acceptance.** Start at N=225 and 450, then increase N. With only the latest scalar array, unchanged prefix slots must stop producing triangular transfer work at issuance **and** settlement. Count tree visits, transfers and live subscriptions separately. With a single current scalar array or a set of scalar histories sharing the same input prefixes, doubling N should eliminate the near-fourfold growth in avoidable pre-export slot work. Track the cost of a balanced-tree update and the cost of actually enumerating live logical occurrences separately. With all numeric histories held, record width-first intermediate and settled heap before export. With managed values, verify actual parent keys before reads and after changes. In a matched 128-push control, one kept view had 128 logical occurrences, while 128 nested historical views exposed 8,256, for both one repeated child and 128 distinct children. Shared storage may compress these relationships. A full export still has to emit each requested element.

### 2. Release inactive regions behind a pending splice

The endpoint path already folds the fixed tail. For 450 open-width pushes it made 449 such folds, allocated 450 regions and returned 450 pending numeric results. Every region's sequence referred to the same left part. With known length the corresponding calls allocated zero open regions and returned zero pending lengths, even with pending payloads.

After the handoff turn, 449 regions had **zero backing owners, point gates, range readers and active indexes**, yet all 450 still held a shape, sequence and settlement result. Keeping all numeric lengths gave identical counts. Reading one historical point every tenth push left 45 regions with point gates and 405 without owners or selection work. Holding every view left 450 regions with a backing owner. The first WeakRef reading follows an event-loop turn and forced GC. Delaying allocation of an unobserved view would address allocation churn. The retained-heap opportunity after that turn is in the older regions and their callbacks. A lazy backing would still have to publish the prescribed logical write and its immediately visible incoming relationships, and preserve each pending length question. The counter measures the named fields only. Presence of a pending shape answer, another capture or an outstanding mutation can still require work.

Inspect `publishSequence`'s settlement and release continuations, `retainLayout`, `ArrayRegion.finishLayout`'s dormant form, `LengthState.capture` and `InvocationWork.releaseInvocation`. The concrete question is whether an inactive backing can relinquish its heavy publication destination and retained input bookkeeping before the width settles. Keep a compact exact shape/forward receipt and any actual point, reader or counter consumers. A shared base width plus per-call offsets may serve independent lengths. Preserve saturating capacity, later index growth and the exact position at which a preceding failure or overflow becomes observable. The public numeric result and its fatal registration remain independent even if the caller discards the Promise. In the current code, the shape setup in `publishSequence` calls `watch(sequence, ...)` without saving its release function. Another callback on `sequence.ready` captures the region and a final callback retains the input-release functions. `ArrayRegion.unwatch` belongs to a point-selection registration. Count each registration separately and make the retirement path release the destination at its last required use. Clearing a field on the region will leave any direct references in callbacks alive. [Sequence publication](../src/array-sequence.js), [captured lengths](../src/array-length.js), [owner activation and retirement](../src/parent-placements.js)

Compare heap and survivor counts for current only, lengths only, one point every ten calls, and every snapshot. Include earlier reads of length and endpoints, captures before and after a later write, deletion and re-entry, reverse delivery, rejection and bounds that settle while payloads stay pending. Measure the retained publication destinations and shape or point listeners alongside the number of live views. Apply the same last-access reasoning to other endpoint edits and to length-preserving operations only where the representation and publication contracts coincide. Preserve the separate compiler-directed append/missing-output semantics.

### Implementation sequence for the structural changes

1. Add the immediate-parent, last-use and work witnesses to the affected test suites, including a disabled-counter or deliberately broken control. Record the baseline for N=225 and N=450. A fresh control should count 25,425 and 101,475 copied slots, respectively, for consecutive prepends.
2. Address the known-prefix transfer with only the current array retained. First verify publication to incoming parent keys, overwritten destinations, borrowed ranges and already-active indexes. Then require the reduced work to persist through both settlement waves.
3. Exercise the same range machinery with the width known and payloads still pending. Verify independent point reads and last-holder release before benchmarking 9, 45 and 450 live historical views. Measure partially resolved and mixed managed/primitive trees as well as the all-primitive case. Each scan or listener needs a bound expressed in actual captures, live owners, changed ranges or emitted occurrences.
4. Evaluate the original current-only push separately. Start with the existing last-backing-owner transition as a potential point to detach the heavy destination. Give selected points, shapes, captures and effects explicit positive controls. Compare Appendix D's census with byte and work measurements from Appendix B. Both structural changes can be pursued independently after the three bounded patches.

## Other opportunities reviewed

- **Compound operations.** The table quantifies queue-style push/shift and push/copyWithin. Earlier 450-operation small-receiver screens measured roughly 13–14 MB for pending fill, copyWithin and flat. Profile the retained preparation, previous chosen value, argument capture and final output separately after the common changes. Keep independent search/iterator progress, removed results, native-call isolation and required Error collection.
- **Repeated observations.** Lookup, Error queries, iterators and export can fan out from one pending version. Compare subscriptions to the same published version against distinct-version controls. Share exact-version bookkeeping where the comparison shows duplication. Each outward result still owns its fatal handling, closed work stops locally, and independent exports produce separate detached graphs. A 225-lookup historical histogram counted 1,800 additional native Promise objects across internal and public layers.
- **Small allocations.** Lazily allocating the preparation Error Set and wait array left 450 pushes at about 8.00 MB and exports at about 4.10 MB on the earlier common-patch snapshot. The clearest change was roughly 0.06 MB for `with`. This has lower priority. Replacing single-item `Promise.all`, coalescing host subscriptions or dropping public fatal delivery can also change scheduling and observable behavior.
- **Already-ready work and source-level batching.** Measure ready throughput and short-circuit hits separately from the pending stress case. A warmed lookup/assignment/search/endpoint screen and three fresh processes that alternated baseline and candidate ready-search runs produced workload-dependent timing. The paired ready-search CPU medians ranged from 60 to 68 microseconds per iteration at baseline and 49 to 64 with the three changes. Elapsed-time results varied with system load. A compiler or caller can issue one variadic call when its source semantics authorize it. An ignored JavaScript result supplies no proof that earlier effects, distinct Errors or historical lengths are unobservable.

## Correctness and review evidence

Apply the all-ready sequential execution model at every intermediate capture, including failed prerequisites and reads around mutations. Give a distinct logical write its prescribed publication identity. Share immutable fragments across snapshots, keep mutable backing ownership explicit and give host callbacks detached exports. Preserve immutable outputs, owner isolation and copy-on-write (COW), failure source and recovery, complete parent indexing, incremental counter updates, admission and cross-execution isolation. Keep FIFO registration on synchronous and deferred supported thenables, fatal-on-escape, and non-blocking issuance. Preserve `MAX_ARRAY_LENGTH` and `MAX_COUNT` semantics, virtual indexes where supported, sparse holes, dense-copy rules, repeated placements, borrowed offsets and source mutation after capture. Use iterative worklists for history-sized activation and release. The authoritative contracts and the existing model oracles are in [AGENTS.md](../AGENTS.md), [data limitations](data-limitations.md), [Array work and release bounds](array-method-specification.md#12-work-and-release-bounds), [ArrayView ownership](array-view.md) and the [test guide](../test/README.md).

### Results on the pinned commit with the three bounded edits

| Review | Outcome |
| --- | --- |
| Default strict-rejection suite | All 6,909 passed in a separate full run using the suite's default time limits. |
| Full suite with the runtime trace loader | All 6,909 passed in a separate full run using the suite's default time limits. |
| Broad workload screen | All 53 passed at N=96 with reverse native delivery in Unordered mode. They include array mutation and copying, scalar searches, path lookup and key handling, capture, export, Error/status queries, closed iterators, assignment, deletion, repair, import and method results, entry, native and managed calls, sparse arrays and cycles. |
| Independent type, ordering and ownership controls | Baseline and candidate each passed 72 combinations of 12 payloads, three Chain modes and two delivery orders. They included a hole distinct from own `undefined`, a retained historical view and a later overwrite. The 20 two-sibling parent/COW cases matched in each revision. A fresh run of 72 managed-child or rejection cases and 12 last-use traces compared the two revisions at issuance, partial delivery, settlement and release. All matched. |
| Flattening and shared-subtree work | All 62 cases of the repository's flattening work fixture passed. A separate hook counted 3,563 visits to the new primitive conversion on this commit. An earlier version without the local traversal cache exceeded one million visits. |
| Expanded histories and delivery differentials | 1,600 seeds each. The Array, nested and external fixtures each ran 9,600 programs across 28,800 runs. The placement fixture passed 6,400 cases. Preparation passed 12,928 reception and 1,600 lifecycle programs. Boundary coverage included 51,200 active and 128 retired-root programs, plus 12,800 separately tested pending repeated-root histories. The Promise-key differential passed 9,602 programs across 28,806 runs. The receiving/invocation differential passed 152,000 histories and 153,600 joint key/data histories. |
| Full conflict matrix | All eight shards passed, totalling 104,040 cases and 312,120 executions. |
| Full publication-pair differential | All 96,824 pairs passed across 290,472 synchronous, native Promise and ordered comparison runs against all-ready execution. The independent write-identity model covered 63,168 pairs, including 10,490 modeled failures. |
| History depth and retirement | All 12 depth histories passed at N=5,000. The separate retirement model completed its 4,096 graph cases, 1,048,576 four-node graphs and 15,000 transitions. |
| Targeted fault injection | Removing source release from thenable continuations and removing retirement of copied destinations each made its intended witness fail. |
| Portable probes | The benchmark checks the final array and each retained result. The lifetime probe passes on the baseline and candidate and fails on each of the two rejected prefix prototypes at its respective assertion. The region census compares independent point, length and holder controls. |

Initial full-suite attempts under concurrent load each exceeded one wall-clock limit. The untraced attempt timed out in a publication-model case and the traced attempt in a flattening subprocess. Each case then passed on both the baseline and candidate in focused runs. Both complete suites subsequently passed with the original deadlines.

The source-anchor audit checked 312 edit patterns across 295 registered safeguards. Four were already stale on the baseline and remained stale in the candidate. In a second run, the current-source fault below was injected in memory for each one. All five intended witness tests passed in healthy controls and failed for the expected reason under their respective fault. Refresh the registry entry when changing the corresponding mechanism.

| Existing safeguard ID | Current-source fault and observed failure |
| --- | --- |
| `array-range-preserves-complete-baseline` | Omit the per-key `copyPlacement` inside `array-remap.js:captureRangeBaseline`. Both fill and copyWithin failed to restore a hole after inspection failure. |
| `array-range-bounds-point-work` | Force the known-length `createRangeOutput` path through `createArrayFromRemap(patchedRemap(...))`. The existing point-work witness detected inspection outside the selected range. |
| `sort-releases-impossible-comparator` | Remove the current poison check that clears `comparator` after a defined candidate in `array-methods.js`. The preparation-output lifetime fixture retained the comparator. |
| `retirement-unregisters-backing-owner` | Remove just `record.owners.delete(owner)` in `parent-placements.js:updateBackingOwners`. The ownership verifier reported an invalid backing owner. The intervening call to `releaseLayout` was what invalidated the older multi-line edit. |

Run the default and traced suites after applying Appendix A. The source-work counters and lifetime probe should also be run before and after each structural change. The repository's test guide lists the seed, shard and model commands. Examples from the repository root follow.

```sh
npm test
node --import ./test/trace-runtime.js --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js "test/**/*.test.js"
npm run test:publication-pairs
npm run test:ownership-model
node --expose-gc --unhandled-rejections=strict test/fixtures/array-history-depth.mjs 5000
node test/safeguards/run.mjs --skip-baseline --parallel=1 thenable-continuation-releases-source retirement-releases-copy-destinations
```

For the expanded runs, set `CASCADA_SEQUENCE_SEEDS=1600` on the six sequence or boundary fixtures, `promise-key-differential.js`, `receiving-invocation-differential.mjs` and the Mocha `pending-boundary-histories.test.js` suite. For `test/fixtures/conflict-matrix.js`, set `CASCADA_CONFLICT_MATRIX=full` and run each `CASCADA_CONFLICT_PART` from `0/8` through `7/8`. These runs used `--import ./test/trace-runtime.js --unhandled-rejections=strict`. Keep the fixture's default small sample for routine iterations. Use the full product to validate a shared transition.

For any subsequent structural implementation, extend the independent oracles and source-work counters in the areas changed. Use the following checks.

1. Replay all three Chain modes using ready values, a synchronous supported thenable, deferred ordered thenables and native Promises. Deliver width first, payload first, interleaved, reverse and shuffled. Check known sibling progress with one input left pending. Complete mode may legitimately wait for its declared prerequisites.
2. Compare numeric lengths and every snapshot with a sequential oracle. Retain only the latest root in one control and every historical root in another. Exercise ignored results, explicit holders, read-only and mutating entry, repair and failure around capacity. Include sparse arrays, shared identities, cycles and overlays before and after delivery.
3. Check incoming `(parent,key)` pairs before optional reads and after indexed publication, overlay writes, last-holder release and re-entry. Verify poison presence, exact causes/source, short-circuit `hasError` and complete `getErrors`. Use `test/verify-refcounts.js` and the backing-producer tests in addition to public exports.
4. Check raw JavaScript liveness with explicit holder clears and forced GC over separate event-loop turns while a sibling stays unresolved. Keep a positive live-holder control and a healthy eventual-completion control. The probe in Appendix C catches the two rejected prefix designs at different assertions.
5. Compare operation counts and retained bytes before exporting stored histories. Record separate issue, partial, settled and released measurements. A decrease at issuance that reappears as historical slot replay at settlement fails the efficiency goal. A branch that never executes can pass the suite, so use active counter and disabled-counter controls. Retain the `array-flat-work`, `array-preparation`, `array-capacity-layout`, `array-backing-producers`, `array-history-storage`, `pending-push-work`, `pending-copy-work`, supported-thenable, fatal and detached-cleanup witnesses.

### Extract the patch and probes

Copy the code blocks from the Markdown source, or run this Python 3.10+ snippet from the repository root. It writes four files to a new temporary directory and prints the path. Use that path when applying the patch or running the probes.

```python
import re
import tempfile
from pathlib import Path

doc = Path("docs/array-memory-implementation-handoff.md").read_text(encoding="utf-8")
output = Path(tempfile.mkdtemp(prefix="cascada-memory-"))
files = ["memory-review.patch", "memory-review.mjs", "memory-review-lifetime.mjs", "memory-review-regions.mjs"]
blocks = re.findall(r"^```(?:diff|js)\n(.*?)^```$", doc, re.M | re.S)
for name, body in zip(files, blocks, strict=True):
    (output / name).write_bytes(body.encode("utf-8"))
print(output)
```

## Appendix A Exact patch for the three bounded changes

The unified diff includes the counter and fault-injection anchor updates. Use the raw Markdown source when extracting a patch so its context whitespace survives. Save the diff block as `memory-review.patch` and run `git apply --check memory-review.patch` at the repository root. Review the source if the revision has changed, then apply it in the implementation branch. Apply a structural change separately after validating its acceptance tests.

```diff
--- a/src/internal-step.js
+++ b/src/internal-step.js
@@ -46,24 +46,19 @@
     if (errorUtils.isFatalError(value))
         errorUtils.failExecution(operationContext, value)
     if (owner && !owner.open) return undefined
-    const guard = callback => result => {
-        if (
-            operationContext.execution.fatalError !== null ||
-            (owner && !owner.open)
-        )
-            return undefined
-        return run(operationContext, callback, result)
-    }
-    // Reception supplies a missing poison source inside the live-work guard,
-    // before the consumer can publish it or perform its failure effects.
-    const fulfill = result => onFulfilled(errorUtils.isPoisonError(result)
-        ? errorUtils.createPoisonError(result, operationContext, result.kind) : result)
-    return languageValues.thenValue(
-        value,
-        guard(fulfill),
-        guard(onRejected),
-        operationContext,
-    )
+    return languageValues.thenValue(value, fulfillGuarded, rejectGuarded, operationContext,
+        { onFulfilled, onRejected, owner, run })
+}
+
+function fulfillGuarded(value, { onFulfilled, owner, run }, operationContext) {
+    if (operationContext.execution.fatalError !== null || (owner && !owner.open)) return undefined
+    return run(operationContext, result => onFulfilled(errorUtils.isPoisonError(result)
+        ? errorUtils.createPoisonError(result, operationContext, result.kind) : result), value)
+}
+
+function rejectGuarded(reason, { onRejected, owner, run }, operationContext) {
+    if (operationContext.execution.fatalError !== null || (owner && !owner.open)) return undefined
+    return run(operationContext, onRejected, reason)
 }
 
 // Complete required-input collection: poison is data held outside the waits;
--- a/src/language-values.js
+++ b/src/language-values.js
@@ -7,35 +7,40 @@
     return mayBeThenable(value, operationContext) && typeof value.then === "function"
 }
 
-function thenValue(value, onFulfilled, onRejected, operationContext) {
+function deliverSubscription(result, callback, state, operationContext) {
+    if (operationContext.execution.fatalError !== null) return undefined
+    if (errorUtils.isFatalError(result)) errorUtils.failExecution(operationContext, result)
+    return callback(result, state, operationContext)
+}
+
+function thenValue(value, onFulfilled, onRejected, operationContext, state) {
     if (errorUtils.isFatalError(value))
         errorUtils.failExecution(operationContext, value)
-    if (!mayBeThenable(value, operationContext)) return onFulfilled(value)
+    if (!mayBeThenable(value, operationContext)) return onFulfilled(value, state, operationContext)
 
     const then = errorUtils.catchExternalThrow(
         () => readCallableThen(value, operationContext),
         operationContext,
         errorUtils.ERROR_KIND.ThenAccessFailed,
     )
-    if (errorUtils.isPoisonError(then)) return onRejected(then)
-    if (then === undefined) return onFulfilled(value)
+    if (errorUtils.isPoisonError(then)) return onRejected(then, state, operationContext)
+    if (then === undefined) return onFulfilled(value, state, operationContext)
 
     let continuationStarted = false
-    const deliver = callback => result => {
-        // Distinguish a continuation escape from a failure of the then body.
-        // Readiness is determined only by the returned transition result.
+    function fulfill(result) {
         continuationStarted = true
-        if (operationContext.execution.fatalError !== null) return undefined
-        if (errorUtils.isFatalError(result))
-            errorUtils.failExecution(operationContext, result)
-        return callback(result)
+        return deliverSubscription(result, onFulfilled, state, operationContext)
+    }
+    function reject(result) {
+        continuationStarted = true
+        return deliverSubscription(result, onRejected, state, operationContext)
     }
     try {
-        return Reflect.apply(then, value, [deliver(onFulfilled), deliver(onRejected)])
+        return Reflect.apply(then, value, [fulfill, reject])
     } catch (reason) {
         if (continuationStarted) throw reason
         return onRejected(errorUtils.createPoisonError(
-            reason, operationContext, errorUtils.ERROR_KIND.ThenInvocationFailed))
+            reason, operationContext, errorUtils.ERROR_KIND.ThenInvocationFailed), state, operationContext)
     } finally {
         // Delivery uses its own result; saved callback frames need no source.
         value = undefined
--- a/test/fixtures/pending-push-work.js
+++ b/test/fixtures/pending-push-work.js
@@ -35,7 +35,7 @@
         ['function retainBackingCounter(version, owner, key, operationContext) {', '$&\n    globalThis.__pendingPushCounts().counterMemberships++;'],
     ]],
     ['language-values.js', [
-        ['return Reflect.apply(then, value, [deliver(onFulfilled), deliver(onRejected)])', 'globalThis.__pendingPushCounts().subscriptions++; $&'],
+        ['return Reflect.apply(then, value, [fulfill, reject])', 'globalThis.__pendingPushCounts().subscriptions++; $&'],
     ]],
     ['thenable-subscription.js', [
         ['promise.then(ignore, ignore)', 'globalThis.__pendingPushCounts().handledSubscriptions++; $&'],
--- a/test/fixtures/pending-copy-work.js
+++ b/test/fixtures/pending-copy-work.js
@@ -29,7 +29,7 @@
             'const complete = () => {\n        if (!measuredClosed) { measuredClosed = true; measured.live-- }\n        unregister?.()'],
     ]],
     ['language-values.js', [
-        ['return Reflect.apply(then, value, [deliver(onFulfilled), deliver(onRejected)])',
+        ['return Reflect.apply(then, value, [fulfill, reject])',
             'globalThis.pendingCopyWorkCounts().subscriptions++; $&'],
     ]],
 ])
--- a/docs/phase5-probes/work-histories.mjs
+++ b/docs/phase5-probes/work-histories.mjs
@@ -37,7 +37,7 @@
             'const complete = () => {\n        if (!measuredClosed) { measuredClosed = true; measured.live-- }\n        unregister?.()'],
     ]],
     ['language-values.js', [
-        ['return Reflect.apply(then, value, [deliver(onFulfilled), deliver(onRejected)])',
+        ['return Reflect.apply(then, value, [fulfill, reject])',
             'globalThis.reviewHistoryCounts().subscriptions++; $&'],
     ]],
 ])
--- a/src/ownership.js
+++ b/src/ownership.js
@@ -84,26 +84,33 @@
 
 // One consumer owns one ledger. Storage is allocated only for managed inputs;
 // multiple appearances within that use share a lease, other consumers do not.
-function createLeaseLedger(operationContext) {
-    let values
-    let closed = false
-    return { acquire, release, get empty() { return !values?.size } }
+class LeaseLedger {
+    #operationContext
+    #values
 
-    function acquire(value) {
-        if (!closed && !values?.has(value) && metadata.isTraversableType(metadata.metaOf(value, operationContext)?.type) &&
+    constructor(operationContext) { this.#operationContext = operationContext }
+    get empty() { return !this.#values?.size }
+
+    acquire = value => {
+        const operationContext = this.#operationContext
+        if (operationContext && !this.#values?.has(value) && metadata.isTraversableType(metadata.metaOf(value, operationContext)?.type) &&
             metadata.incrementReadLease(value, operationContext))
-            (values ??= new Set()).add(value)
+            (this.#values ??= new Set()).add(value)
         return value
     }
 
-    function release() {
-        if (closed) return
-        closed = true
-        if (values && operationContext.execution.fatalError === null)
-            for (const value of values) metadata.decrementReadLease(value, operationContext)
-        values = undefined
-        operationContext = undefined
+    release = () => {
+        const operationContext = this.#operationContext
+        if (!operationContext) return
+        this.#operationContext = undefined
+        if (this.#values && operationContext.execution.fatalError === null)
+            for (const value of this.#values) metadata.decrementReadLease(value, operationContext)
+        this.#values = undefined
     }
+}
+
+function createLeaseLedger(operationContext) {
+    return new LeaseLedger(operationContext)
 }
 
 // A pending writer retains its destination but does not freeze its contents.
--- a/test/fixtures/detached-cleanup-failure.js
+++ b/test/fixtures/detached-cleanup-failure.js
@@ -14,7 +14,7 @@
 registerHooks({ load(url, context, next) {
     const result = next(url, context)
     if (normalizeModuleURL(url) !== normalizeModuleURL(target)) return result
-    const marker = "function release() {\n        if (closed) return"
+    const marker = "release = () => {\n        const operationContext = this.#operationContext\n        if (!operationContext) return"
     const source = String(result.source).replaceAll("\r\n", "\n")
     assert(source.includes(marker), "Lease cleanup fault anchor needs updating")
     return { ...result, source: source.replace(marker,
--- a/src/array-layout.js
+++ b/src/array-layout.js
@@ -149,9 +149,32 @@
     return placements
 }
 
+// A settled primitive on an ordinary captured producer can live in the shared
+// terminal layout. Open selectors and managed deliveries retain their own path.
+function settledScalarLayout(node, seen = new Map()) {
+    if (!node.stored || !node.fixedPresence) return node
+    if (node.scalarLayout) return node.scalarLayout
+    if (seen.has(node)) return seen.get(node)
+    let result = node
+    if (node.left) {
+        const left = settledScalarLayout(node.left, seen), right = settledScalarLayout(node.right, seen)
+        if (left !== node.left || right !== node.right) result = branch(left, right)
+    } else {
+        const p = node.placement, v = p.sourceVersion
+        if (v && v.present === true && !v.publication && !v.copiedDelivery && !v.transition && !v.pendingPresence &&
+            !v.ownFailure && !v.role && !v.discoveryBlocked && p.present === true &&
+            !p.ownFailure && !p.role && !p.discoveryBlocked && isObjectLike(p.value) && !isObjectLike(v.value))
+            result = span(node.length, { ...p, value: v.value, sourceVersion: undefined })
+    }
+    if (!result.stored) node.scalarLayout = result
+    else seen.set(node, result)
+    return result
+}
+
 // Publish a repeated placement once, including its managed parent relationships.
 // An open prefix leaves repeated producers in the region until they settle.
 function compactLayout(node, ctx, prefix = false) {
+    if (!prefix && node.stored && node.fixedPresence) node = settledScalarLayout(node)
     if (!node.stored) return node
     const repeated = new Set()
     for (const [p, count] of placementCounts(node, part => part.stored)) {
```

## Appendix B Portable workload and work counters

Save the next block as `memory-review.mjs` and run it with the target repository as the working directory. The examples assume the script is in that directory. Substitute its absolute path if you extracted it elsewhere. It uses only that repository and Node. Arguments are method, N, holder frequency (0, every Kth view, or `lengths`), delivery order and optional `work`. Heap-only runs use fresh processes. Run work counters separately from heap comparisons. At the pinned baseline the first command counts 101,475 prefix transfers and the second counts 101,475 stored-slot visits during the second wave. Counter anchors identify the existing implementation. Re-anchor them to equivalent physical publication and traversal when changing the implementation.

```sh
node --expose-gc memory-review.mjs unshift 450 0 payloads-first work
node --expose-gc memory-review.mjs push 450 1 payloads-first work
node --expose-gc memory-review.mjs push 450 1 width-first
node --expose-gc memory-review.mjs push 450 10 width-first
node --expose-gc memory-review.mjs push 450 lengths payloads-first
```

```js
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [method = 'push', count = '450', keep = '0', order = 'payloads-first', instrument] = process.argv.slice(2)
const n = Number(count), counts = {}
let phase = 'setup'
if (instrument === 'work') {
    globalThis.noteArrayWork = name => {
        const bucket = counts[phase] ??= {}
        bucket[name] = (bucket[name] ?? 0) + 1
    }
    registerHooks({ load(url, context, next) {
        const mod = next(url, context)
        let anchor, change
        if (url.endsWith('/src/array-region.js')) {
            anchor = 'storedPlacements(head, (index, p) => transferPlacement(p, region.producers, String(index), ctx, undefined, undefined, false))'
            change = "storedPlacements(head, (index, p) => { globalThis.noteArrayWork('prefixTransfers'); transferPlacement(p, region.producers, String(index), ctx, undefined, undefined, false) })"
        } else if (url.endsWith('/src/array-layout.js')) {
            anchor = 'for (let offset = 0; offset < part.length; offset++) visit(index + offset, part.placement)'
            change = "for (let offset = 0; offset < part.length; offset++) { globalThis.noteArrayWork('storedSlotVisits'); visit(index + offset, part.placement) }"
        } else return mod
        const src = String(mod.source)
        assert.equal(src.split(anchor).length, 2, 'Check the counter anchor in ' + url)
        return { ...mod, source: src.replace(anchor, change) }
    } })
}
const r = await import(pathToFileURL(resolve('src/index.js')))
const ctx = { execution: new r.Execution(), errorContext: 'memory review' }
const mut = { mutationScopeDepth: 0 }
const bind = x => new r.Chain(x, ctx, r.CHAIN_MODE.Unordered)
const turn = () => new Promise(setImmediate)
const heap = () => { global.gc(); return process.memoryUsage().heapUsed }
const width = Promise.withResolvers(), signals = [], holders = [], lengths = []
let target = bind(['A', 'B', 'C'])
r.run(target, [], 'splice', [1, width.promise], ctx, mut)
await turn()
const initial = heap(), heaps = {}
phase = 'issue'
for (let i = 0; i < n; i++) {
    const signal = Promise.withResolvers()
    signals.push(signal)
    const value = signal.promise
    let result
    if (method === 'push' || method === 'unshift') {
        result = r.run(target, [], method, [value], ctx, mut)
    } else if (method === 'splice') {
        r.run(target, [], method, [0, 0, value], ctx, mut)
    } else {
        const previous = target
        if (method === 'toSpliced') {
            target = bind(r.run(previous, [], method, [0, 0, value], ctx, {}))
        } else {
            assert.equal(method, 'concat')
            const prefix = bind([value])
            target = bind(r.run(prefix, [], method, [r.lookupPath(previous, [], ctx)], ctx, {}))
            r.assignPath(prefix, [], undefined, ctx)
        }
        r.assignPath(previous, [], undefined, ctx)
    }
    if (keep === 'lengths') {
        assert(method === 'push' || method === 'unshift')
        lengths.push(result)
    } else if (Number(keep) && (i + 1) % Number(keep) === 0) {
        holders.push([i + 1, bind(r.lookupPath(target, [], ctx))])
    }
}
heaps.issue = heap() - initial
await turn()
heaps.pending = heap() - initial
function deliverValues() {
    for (let i = n - 1; i >= 0; i--) signals[i].resolve(i)
    signals.length = 0
}
assert(['width-first', 'payloads-first'].includes(order))
phase = 'first'
if (order === 'width-first') width.resolve(1); else deliverValues()
await turn(); await turn()
heaps.first = heap() - initial
phase = 'second'
if (order === 'width-first') deliverValues(); else width.resolve(1)
await turn(); await turn()
heaps.settled = heap() - initial
phase = 'verify'
function expected(k) {
    const values = Array.from({ length: k }, (_, i) => i)
    return method === 'push' ? ['A', 'C', ...values] : [...values.reverse(), 'A', 'C']
}
assert.deepEqual(await r.export(target, [], ctx), expected(n))
for (const [k, holder] of holders) assert.deepEqual(await r.export(holder, [], ctx), expected(k))
for (let i = 0; i < lengths.length; i++) assert.equal(await lengths[i], 3 + i)
for (const [, holder] of holders) r.assignPath(holder, [], undefined, ctx)
r.assignPath(target, [], undefined, ctx)
target = undefined
holders.length = lengths.length = 0
await turn(); await turn()
heaps.released = heap() - initial
assert.equal(ctx.execution.fatalError, null)
console.log(JSON.stringify({ method, n, keep, order, heaps, counts }))
```

## Appendix C Immediate parent and last-use witness

Save as `memory-review-lifetime.mjs` and run `node --expose-gc memory-review-lifetime.mjs` from the repository root. The first assertion caught missing immediate parent links in the historical fast-prefix trial. The WeakRef assertion caught the independently observed ready-child retention in the historical aggregate trial. Both assertions pass on the pinned baseline and the three bounded changes.

```js
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const local = file => import(pathToFileURL(resolve('src', file)))
const r = await local('index.js')
const { getParentPlacements } = await local('parent-placements.js')
const ctx = { execution: new r.Execution(), errorContext: 'managed child release' }
const mut = { mutationScopeDepth: 0 }, bind = x => new r.Chain(x, ctx)
const turn = () => new Promise(setImmediate)
const cut = Promise.withResolvers(), slow = Promise.withResolvers(), fast = Promise.withResolvers()

function issue() {
    const source = bind(['A', 'B', 'C'])
    const child = bind(r.import({ value: 7 }, ctx))
    const id = r.lookupPath(child, [], ctx)
    r.run(source, [], 'splice', [1, cut.promise], ctx, mut)
    r.run(source, [], 'unshift', [slow.promise, fast.promise, id], ctx, mut)
    function keys() {
        return getParentPlacements(id, ctx)
            .filter(p => p.parent === source._state.value).map(p => p.key).sort()
    }
    assert.deepEqual(keys(), ['2']) // Before any point read of the result.
    const held = bind(r.lookupPath(source, [], ctx))
    const ref = new WeakRef(id)
    r.assignPath(child, [], undefined, ctx)
    return { source, held, ref }
}

const state = issue()
// Keep the healthy second input independent of the managed child. The native
// Promise for fast therefore cannot itself keep the child alive in this probe.
fast.resolve(8)
cut.resolve(1)
await turn()
assert.equal(await r.lookupPath(state.held, ['length'], ctx), 5)
assert.equal(await r.lookupPath(state.held, [1], ctx), 8)
assert.equal(await r.lookupPath(state.held, [2, 'value'], ctx), 7)
r.assignPath(state.source, [], undefined, ctx)
r.assignPath(state.held, [], undefined, ctx)
state.source = state.held = undefined
await turn(); global.gc(); await turn(); global.gc()
assert.equal(state.ref.deref(), undefined)
slow.resolve(0)
await turn()
assert.equal(ctx.execution.fatalError, null)
console.log('Immediate parent publication and last-use release passed')
```

## Appendix D Region ownership and selection census

Save as `memory-review-regions.mjs`. Run `node --expose-gc memory-review-regions.mjs current 450`, then repeat with `lengths`, `points` and `views`. Each count of owners, gates, readers or indexes is the number of live regions having at least one. The probe keeps weak references to the regions and verifies the public outputs independently. At the pinned baseline with `current`, expect 450 live regions with unresolved width, one with an owner and 449 with none of those four interests. With `points`, 45 regions have gates. With `views`, 450 regions have owners. When changing the representation, measure its equivalent retained resources and make sure the controls still discriminate.

```js
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [holding = 'current', count = '450'] = process.argv.slice(2)
assert(['current', 'lengths', 'points', 'views'].includes(holding))
const n = Number(count), regions = []
globalThis.recordPushRegion = region => regions.push(new WeakRef(region))
registerHooks({ load(url, context, next) {
    const mod = next(url, context)
    if (!url.endsWith('/src/array-region.js')) return mod
    const src = String(mod.source), anchor = 'super(span(0))'
    assert.equal(src.split(anchor).length, 2, 'Check the ArrayRegion constructor anchor')
    return { ...mod, source: src.replace(anchor, anchor + '\n        globalThis.recordPushRegion(this)') }
} })
const r = await import(pathToFileURL(resolve('src/index.js')))
const ctx = { execution: new r.Execution(), errorContext: 'region obligations' }
const mut = { mutationScopeDepth: 0 }, bind = x => new r.Chain(x, ctx, r.CHAIN_MODE.Unordered)
const turn = () => new Promise(setImmediate)
const width = Promise.withResolvers(), inputs = [], lengths = [], views = [], points = []
const target = bind(['A', 'B', 'C'])
r.run(target, [], 'splice', [1, width.promise], ctx, mut)
regions.length = 0 // Count only the following pushes.
for (let i = 0; i < n; i++) {
    const input = Promise.withResolvers()
    inputs.push(input)
    const length = r.run(target, [], 'push', [input.promise], ctx, mut)
    if (holding === 'lengths') lengths.push(length)
    if (holding === 'views') views.push(bind(r.lookupPath(target, [], ctx)))
    if (holding === 'points' && (i + 1) % 10 === 0)
        points.push([r.lookupPath(target, [i + 2], ctx), i])
}
async function census() {
    await turn(); global.gc(); await turn(); global.gc()
    const counts = { live: 0, owners: 0, unselectedWithoutOwner: 0, gates: 0, readers: 0,
        indexes: 0, shape: 0, sequence: 0, settlement: 0 }
    const bases = new Set()
    for (const ref of regions) {
        const region = ref.deref()
        if (!region) continue
        counts.live++
        const owned = Boolean(region.producers?.backing.owners.size)
        if (owned) counts.owners++
        if (region.gates?.size) counts.gates++
        if (region.readers?.size) counts.readers++
        if (region.indexed?.size) counts.indexes++
        if (!owned && !region.gates?.size && !region.readers?.size && !region.indexed?.size)
            counts.unselectedWithoutOwner++
        if (region.shape) counts.shape++
        if (region.sequence) counts.sequence++
        if (region.sequence?.parts) bases.add(region.sequence.parts[0])
        if (region.settlement) counts.settlement++
    }
    return { ...counts, distinctLeftParts: bases.size }
}
const before = await census()
for (let i = n - 1; i >= 0; i--) inputs[i].resolve(i)
inputs.length = 0
const payloads = await census()
width.resolve(1)
const settled = await census()
for (let i = 0; i < lengths.length; i++) assert.equal(await lengths[i], i + 3)
for (const [result, expected] of points) assert.equal(await result, expected)
for (let i = 0; i < views.length; i++) assert.equal(await r.lookupPath(views[i], ['length'], ctx), i + 3)
assert.deepEqual(await r.export(target, [], ctx), ['A', 'C', ...Array.from({ length: n }, (_, i) => i)])
for (const view of views) r.assignPath(view, [], undefined, ctx)
views.length = points.length = lengths.length = 0
r.assignPath(target, [], undefined, ctx)
const released = await census()
assert.equal(ctx.execution.fatalError, null)
console.log(JSON.stringify({ holding, n, before, payloads, settled, released }))
```
