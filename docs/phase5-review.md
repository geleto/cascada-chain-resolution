# Phase 5 execution review

Status: **complete on the final pinned candidate**. Execution began on 2026-10-22 against `d47332b39531a7ddab3ffb40f417e025bb9234a3`, Node v24.14.1, Windows. The pre-existing edits to `phase5-stabilization.md`, `runtime-evolution-plan.md`, and `test/README.md` form the requested specification and are preserved. No historical pass total is treated as current acceptance. The final 246-file source/test pin is `bb57d772e6ca9eb76dac5ff96ddeba3b79502b4a041a546e10f9bc838f538ca8`. All **54 acceptance jobs passed**, including 5,299 normal and 5,299 traced tests; all **217 safeguard entries** have reviewed current detections. The [portable acceptance record](phase5-acceptance.json) retains the manifest, commands and results, and the [sensitivity record](phase5-sensitivity.json) maps 22 rows to 86 scoped obligation groups. No known actionable present-contract defect or unexplained required evidence gap remains in the completed review.

## Candidate and evidence

For a manually initiated repeat, use the [Phase 5 rerun procedure](prompts/phase5-rerun.md). Preserve this closure and its acceptance/sensitivity JSON files; record each later run separately and link it here. No rerun is currently open.

The initial SHA-256 source/test/tool/document manifest and command logs are in `%TEMP%/cascada-phase5-evidence`. The initial manifest covers `src`, `test`, `docs`, `AGENTS.md`, `package.json`, and `package-lock.json`; it is called `baseline-manifest.json`. Final acceptance must pin the resulting candidate separately and verify any reused evidence against that manifest. A temporary log path is an investigation aid, not a retained regression or portable acceptance record.

Baseline normal command:

```powershell
node --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js 'test/**/*.test.js' --timeout 30000 --reporter dot
```

The initial run completed with **5,176 passes and two timeouts** in 11 minutes. The failures were the instrumented finite preparation back-reference worker (its five-second child deadline) and the entered external conflict-model test (its ten-second test deadline). Both passed together on an isolated rerun in 22 seconds. No semantic assertion failed in that run. Test-harness files were being edited concurrently, so the initial manifest plus this run is investigation evidence, not a clean final-candidate certificate; a new pinned normal/traced run was therefore required and is recorded in the final acceptance section.

```powershell
node --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js test/boundary-lifetimes.test.js test/operation-sequences.test.js --grep 'completes finite preparation back-references, plain=false|matches an independent conflict model, entered=true' --timeout 30000 --reporter dot
```

The failure-continuation implementation passed 312 focused existing/generated tests with a suitable timeout. Its final 13 controls passed normally and traced: 412 independent comparison cases (980 individual replay runs) across all six existing runners, with no failures or skips in those clean controls. Separate deliberately failing controls verified two failures separated by healthy cases, failure caps and skipped counts, worker restart after escape/deadline, and missing-loader rejection. Case summaries and abandoned sibling replays remain distinct.

The receiving/invocation differential passed a **1,600-program traced investigation run: 152,000 histories, 240 checked joint keys, zero failures/skips**, in 451.63 seconds. This was still production `d47332b...`, before the B22 representation implementation. The agent's sorted production manifest digest was `c3cd4755dc4c5b9b7664fd361328afe9212d7d881569188f07f9ddfbda965979`; support snapshot digest was `df1159e608de4f45edbfa6ff3f02e4bcefc01e33f1af7efb8adf6546f66b35db`. The run does not certify a later B22 candidate. The bounded differential also passes five executed production-fault controls (value, alias, missing poison, mutation effect, completion) and a no-op-loader control.

Root-added execution-interaction regressions pass normally and traced: two live executions import one host graph, one retires/re-enters and then fails fatally while the other completes delayed failed-inspection reuse; declaration changes affect only later independent admission and one execution's authority conflict does not propagate to another. The mixed-case loader regression now runs actual upper/lower Windows drive entries, not merely a URL-string unit check. Optional tracer receipt files distinguish loader startup from actual runtime execution for every worker PID; the positive/no-op controls verify that distinction. Safeguard reports retain failure details and all observed loader PIDs, rather than only titles.

Production fixes, tests, and independent review are separate work streams. The B22 investigator owns the work-bound witness and any justified implementation; separate investigators own the retained receiving differential and independent-case failure continuation. No production experiment is accepted merely because it reduces heap samples.

## Route inventory

The package surface in `src/index.js` has these semantic command routes: `import`, `importMethodResult`, `lookupPath`, `lookupPathForExpression`, `export`, `hasError`, `getErrors`, `assignPath`, `deletePath`, `repairPath`, `run`, and `enter`; `Chain` and `ContextChain` initialize roots. Configuration uses `externalState`, `managedState`, and `managedStateClass`. Error factories/predicates, expression transport, `Execution`, and guarded composition (`runInternalStep`, `continueOperation`, `returnOperationResult`, `runExternalBoundary`, `isPending`) retain distinct integration roles, not extra graph-operation transports.

`runOperation`/`runManagedOperation` provide receiving entry and one outward result boundary. Path work dispatches by admitted category: managed placements, logical Arrays, managed classes, exact external receivers, and Strings. External property reception uses common import for observation-only sources and detached ready-only capture for registered mutable sources. Native managed calls capture a complete receiver, export explicit arguments, select the member, assemble, invoke, and validate mutation receivers. Result admission and receiver publication have separate outcomes. Ordinary records select only own enumerable function placements; managed classes use the admitted prototype chain; external members are exact native actions. Controlled Arrays and Strings do not consult application overrides.

The controlled Array catalogue is `at`, `concat`, `copyWithin`, `fill`, `flat`, `includes`, `indexOf`, `join`, `lastIndexOf`, `pop`, `push`, `reverse`, `shift`, `slice`, `sort`, `splice`, `toReversed`, `toSorted`, `toSpliced`, `toString`, `unshift`, and `with`. Their distinctions remain explicit: index/range selection; payload retention versus conversion; complete scalar conversion; ordered versus any-match searches; comparator export; shape/length publication; and returned element, receiver, new Array, or length. Coverage must retain those method-specific distinctions.

## Obligation ledger

The following identifies current boundaries and retained evidence. Each linked companion audit traces callers, bypass producers, state transfer and resource exits. All rows are verified on the final candidate through their retained tests, source review and the scoped sensitivity mapping. A row disposition does not expand a representative fault into exhaustive coverage of every caller.

| ID | State and transition to inspect | Retained witness / sensitivity entry | Current disposition |
| --- | --- | --- | --- |
| B01 | `receiveValue` → `prepareInput`; prepared-reference stop, pending segment producer and re-entry | method-result identity, pending histories, preparation back-references; `prepared-result-stop`, `preparation-preserves-version-authority` | Verified on final candidate; [trace](phase5-independent-review.md) |
| B02 | `validateReceiver`; staged admission/topology only after full validation, including stored Functions | managed invocation, result-contract; `receiver-admits-stored-functions`, `receiver-admission-is-transactional` | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B03 | receiver adoption/imported protection; exported argument aliases after success/failure | invocation preparation, boundary contracts; receiver/result and ownership safeguards | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B04 | capture every representation, canonical domain/cell partition, native assembly | representation/snapshot/write identity; `capture-inspects-every-representation`, `capture-waits-for-partition` | Verified on final candidate; [trace](phase5-independent-review.md) |
| B05 | preparation and method selection before output identity; controlled consumers' shape/frontier | snapshot identity, invocation preparation; `selection-precedes-output-identity`, `managed-snapshot-does-not-wait-for-partition` | Verified on final candidate; [trace](phase5-independent-review.md) |
| B06 | admission facts/declarations; common reception and fresh snapshot categories | receiving contracts, data classes, stable-receiving-categories; `snapshot-preserves-external-categories` | Verified on final candidate; [trace](phase5-surface-audit.md) |
| B07 | path dispatch and selected receiver, managed suffix boundary, expression extraction | receiving paths, expression boundary; presence/scalar/fatal/managed-boundary safeguards | Verified on final candidate; [trace](phase5-surface-audit.md) |
| B08 | staged branch poison and fixed unreadable-placement masking | receiving-branch-poison, receiving order, Array preparation; `structural-poison-stays-local` | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B09 | preparation-owned weak inspection-failure map; discovery reuse; completed capture clearing | classification failures, inspection outcomes; failure reuse/history/release safeguards | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B10 | source availability and `discoveryBlocked` through capture/copy/publication; authority recheck after waits | external context/binding diagnostics; copy/publication discovery safeguards | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B11 | own mutation failure versus blocker; repair preserves prior placement/recovery | scope recovery; `late-conflict-preserves-mutation-failure`, `blocked-repair-preserves-placement` | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B12 | native completion versus independent result admission; exact-receiver weak policy | boundary policy, receiver-identity, terminal-release; terminal/result-policy safeguards | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B13 | Error/Function precedence, poison reception, causal external escape versus internal fatal | native-error-data, declaration boundaries, poison reception; Error/classification safeguards | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B14 | query reflection outcome, selected external-property import, graph remains unpoisoned | query failures, receiving paths; `has-error-keeps-boolean-outcome`, `query-receives-external-properties` | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B15 | causal leaf/source/kind union and `Object.is` context equality | error union, attribution, boundary contracts; `error-source-preserves-signed-zero` | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B16 | reservations precede waits; captured namespace and selected receiver; native access ends at capture | external paths, entry dependencies; authority/access/entry safeguards | Verified on final candidate; [trace](phase5-boundary-audit.md) |
| B17 | Array/String consumption, shape still needed after discarded output, complete failure collection | Array complete collection/consumption and preparation-output-release; shape/comparator/argument safeguards | Verified on final candidate; [trace](phase5-surface-audit.md) |
| B18 | source, prototype, cause-frame, callback, destination, policy and external-tree last access | boundary lifetimes and release fixtures; resource-specific registry witnesses | Verified on final candidate; [trace](phase5-surface-audit.md) |
| B19 | complete placement state and producer transfer, destination commit/fallback, retirement/re-entry | placement/publication/ownership suites; publication, capture, recovery and retirement safeguards | Verified on final candidate; [trace](phase5-independent-review.md) |
| B20 | source-free identity cells/domains, union forwarding, local query detach, completed record lifetime | identity-work and snapshot-identity-lifetime; domain/partition/comparison safeguards | Verified on final candidate; [trace](phase5-independent-review.md) |
| B21 | fatal-on-escape, exact pending result registration lifetime, shared settlement before local closure | fatal execution, runtime boundaries, capture-fatal; outward/closure safeguards | Verified on final candidate; [trace](phase5-surface-audit.md) |
| B22 | Shared Array backing producers and owner-local overlays; physical storage, logical parents and indexed consumers remain distinct | Strict pending-push counter witness, retained views, rejection/repair and ownership-work | Verified on final candidate; [trace](phase5-b22-review.md) |

B22 is reproduced by a retained strict normal-acceptance test; [its detailed review](phase5-b22-review.md) identifies `copyArrayOverlays` -> `transferPlacement` -> `continueCapturedPromiseVersion` as the quadratic producer chain. The shared-producer correction removes that chain from bounds-only successors. An initial settlement-time owner scan was replaced by maintained optional indexed-consumer relationships. The strict fixture now accounts for issuance, partial/final settlement, rejection/repair, every new maintained store and requested owner allocation, with retained-view controls and an executed legacy-copy fault. On 2026-10-22 the user explicitly selected **"Implement and validate shared backing producers (recommended)"**. No language or work contract was weakened. Rejected integration candidates and their subsequent corrections are recorded below; full acceptance uses a new pin.

## Additional supported finding: retired query reception

The B13+B14+B15 intersection audit found a second present-contract defect. Two overlapping Error queries receive an observation-only external property containing pending descendants. After the root retires and those descendants settle, receiving the same prepared root again could leave its optional counter index pointing to a retired child and throw a fatal `Ref counts require a ref-indexed value`. The reduced case requires neither poison nor reflection failure.

The common `receiveValue` boundary now activates the prepared root's maintained relationships before its consumer. Ordinary end-of-transition retirement still applies; the change adds no lease, host reinspection or retained state, and indexing itself remains non-receiving. `phase5-boundary-intersections.test.js` retains healthy/rejected, native/ordered and query-order controls with actual retirement checks, plus the original reflection/causal-membership case. The final component subset passed 459 tests normally and traced in independent review, plus 137 retention checks and receipt-bearing removal faults. Integrated final-candidate acceptance is separate because the Array representation changed concurrently.

## Independent review during implementation

The independent reviewer `/root/independent_review` inspected the new continuation helper/integrations and the B22 witness without authoring them. Its 27-file pre-implementation review manifest has SHA-256 `019fd1da768d47009074884a3696f8aa8e1307624463385e0b3c059edf8c6e2b` (`independent-review-manifest.json` in the evidence directory). Eighteen loader/continuation controls passed normally and traced. The reviewer independently reproduced the strict B22 failure and confirmed the documented retirement/capture trace. Its observation that strict budgets initially covered only issuance was corrected: partial/final cumulative work is now checked too. The final candidate includes full allocation accounting for the new representation and reverse rejection/repair controls.

The differential author independently reviewed the root's loader and cross-execution changes and found two evidence defects: mixed drive casing could split tracing state, and safeguard title matching could count infrastructure failures. Both were corrected and focused tests passed. Safeguard failure details now distinguish timeout/startup from intended witnesses; parent loader receipts are explicitly only parent evidence. Per-witness child execution and semantic assertion sensitivity were subsequently reconciled in the complete final audit. These focused reviews do not substitute for the required final independent production review.

## Rejected first integrated candidate

The first integrated source/test/AGENTS/package manifest contained 244 files with digest `461f0b60627082a4a1875e078bb91f377bb0cc2e443d8bcd1a7b424643a73cc7`. Its normal suite and 1,600-seed preparation run were deliberately stopped after independent review found actionable shared-producer integration defects. Neither incomplete run counts toward acceptance.

The reviewer reduced three supported failures:

- Installing an indexed queued mutation left its owner subscribed to the masked canonical version. A nested rejection was counted twice; replacing it left `hasError` incorrectly true even when `getErrors` was null and export was healthy.
- A completed entered deletion detached its local absence after physical deletion, exposing the still-present canonical backing producer again.
- Length truncation enumerated only local versions and could publish before a canonical producer's required structural transition finished.

The production author corrected these existing authoritative transitions and retained the public histories. Independent review traced the direct version-store readers and installers, checked the corrected public reductions, and witnessed all three isolated faults. This is an implementation correction, not a change to the language's sequencing, absence or query contracts. The scoped 266-test normal/traced review did not replace full acceptance.

## Rejected second integrated candidate

The second 244-file manifest had normalized digest `2480bb1a766e1201a370cf867ebbb654f6a4a6a564d1a7d0356f95a2de95efab`. Its full normal run completed with **5,280 passing and six failing tests**. All six failures came from existing supported reflection sweeps (`flat`, `join`, `toSorted`, `sort`, `concat`, and `slice`): a new producer-record `instanceof` check inspected a user Proxy's prototype during counter-update preparation, converting a recoverable reflection failure into a fatal internal failure. These are semantic failures, not overloaded deadlines. The candidate was rejected; the classification audit then replaced all four reflective dispatch uses before further acceptance.

Its traced 1,600-seed preparation run separately passed 14,528 comparison cases (12,928 reception programs and 1,600 lifecycle programs; 43,584 individual runs), with zero failures/skips. That investigation result belongs to the rejected pin and does not certify the next correction.

## Third candidate: rejected during larger validation

The third source/test/AGENTS/package manifest contains 244 files with normalized digest `f35d6b51ddb3cd7c5c1d931e6cf8d951c47fbe21bfcda0240a3734398aec121e`. All four backing-record dispatch sites now use existing execution-local `backingOwners` metadata rather than reflecting on application identities. The independent parent verifier uses the same non-reflective distinction while continuing to derive logical placements independently. New public regressions cover cached Proxy Array length and Proxy record parent/publication bookkeeping; four isolated faults restore the unsafe probes and fail their intended assertions.

The non-author [independent review](phase5-independent-review.md) checked this exact pin, passed 296 tests normally and traced, witnessed all seven faults for the two rejected candidates, and repeated actual pending-backing GC controls with live-owner controls. The [complementary surface review](phase5-surface-audit.md) passed 80 checks normally and traced, covering retirement/re-entry without host reinspection, native capture/adoption, every controlled Array method, mutable snapshots and pending source release. Both reviewers found no remaining actionable issue in their documented scopes, and verified the source/test hashes after execution.

The full normal suite passed **5,288 tests** in 253.96 seconds with no changed inputs. The traced 1,600-seed preparation run passed 14,528 cases; placement passed 6,400 traces; receiving/invocation passed 152,000 histories with 240 joint keys. The direct strict B22 fixture also passed. These runs belong to this pin.

Larger Array validation then failed at program 1,948 (seed 440236073, observed harness) with `Cannot write outside an ArrayView range`. Independent reduction identified the throwing destination as the internal producer record, whose physical backing was shorter than an already authorized logical placement. Applying the bounded-view write guard to that internal physical-coordinate record was incorrect. The candidate was rejected, and its incomplete conflict-matrix run was deliberately stopped before correction.

The full traced suite separately completed with **5,287 passes and one harness failure**: the intentional no-op-loader control inherited the real tracer through `NODE_OPTIONS`. Only that negative control now clears `NODE_OPTIONS`; positive and ordinary subprocess controls still inherit instrumentation. Its thirteen controls pass normally and with the inherited tracer after correction.

The 206-entry safeguard run reported 205 witnessed faults and one unlisted fault. Common reception now restores a cached argument before its lease, making the old named lease-restoration witness insensitive; the full fallback found the distinct private/detached-version receiving route that still requires lease restoration. After source review, the witness was migrated to that directly detected private/detached route. The negative-control test edit occurred while that last fallback was finishing, so the run's manifest records the changed input and the complete registry will run again on the final pin. The per-entry diagnostic review remains investigation evidence, not final acceptance. Reconciliation also identified missing distinct success-adoption and required/optional-storage policy faults; these were retained with successful no-op controls and passed final sensitivity reconciliation.

## Fourth candidate: rejected by retained Error-stack review

The fourth 244-file manifest has normalized digest `62b2332b5d705e5baec9ec8f5063e930d21576731ba999d37a1ad8d546d9c249`. Both full suites passed **5,292 tests**, normally in 425.41 seconds and traced in 471.58 seconds. The traced run recorded actual production execution in 199 process instances, separately from 214 loader-startup receipts. Counts distinguish successive uses of a Windows PID by their ordered startup events. Preparation passed 14,528 cases, placement passed 6,400 traces, and conflict partitions 0/8 and 1/8 each passed 11,705 cases and 35,115 individual runs. Every completed run had unchanged source/test inputs.

The fifteen startup-only instances have explicit limits: thirteen coordinate executed child workers, one is B22's deliberately disabled counter-loader control, and one is the browser portability test's raw `SourceTextModule` execution. That last test exercises real semantics but intentionally bypasses Node loader instrumentation to check browser-safe imports. It is not counted as a traced runtime worker.

A further read-only review found an unused physical-length observation stored in `ArrayBackingProducers`. Its only consumers were generic retain/release calls that do nothing for a Number; actual physical length already comes from the backing record's required reflection path. Independent investigation then found a broader supported lifetime defect: each of six post-admission length-read failure positions in a mutable pending push retained the discarded Proxy Array and raw backing through an unformatted poison/cause stack. Healthy discarded controls collected both; live controls retained both until release. Formatting stacks freed the failed cases, which identifies the retention mechanism but is not an acceptable fix.

This present-contract defect rejects closure despite the passing suites. The remaining Array, nested and conflict partition 2 runs were deliberately stopped before source edits; they supply no acceptance result. The correction must remove the unused observation and clear spent bindings around required fallible reflection, preserve the exact cause, and pass retained unformatted-stack controls. The final candidate must reopen the affected lifetime and integrated acceptance gates.

## Fifth candidate: accepted

The fifth source/test/AGENTS/package manifest covers **246 files** with normalized digest `bb57d772e6ca9eb76dac5ff96ddeba3b79502b4a041a546e10f9bc838f538ca8`. Relative to candidate four, three production files changed: `array-view.js`, `array-methods.js` and `parent-placements.js`. The producer no longer stores an unused physical-length observation; required length reads and synchronous extension/append construction clear spent source, backing, callback and suffix bindings. Generic relationship lifetime code permits the producer's absent logical length state. No language contract changed.

Independent retained tests cover forty supported storage/reflection failures and seven healthy/live/released controls, preserving exact unformatted causes, kinds and source contexts. They pass at stack limits 10, 50 and 1,000, normally and traced. Removing the four protections reaches the intended collection assertions in actual child workers. The review also checked sibling `slice`, `pop` and `shift` length failures and found no further source leak. Separate indexed-view controls prove that retirement releases canonical-counter memberships while the backing and pending producer remain live, then safely completes later settlement.

The sensitivity review found and closed two further evidence gaps without production changes: exported managed arguments' last use before unfinished receiver finalization, and removal of settled outward-result reject actions while their executions remain live. The retained faults now witness those distinct lifetimes. Healthy/no-op controls pass. The registry contains **217 current entries**, all with matching source anchors; anchor matches alone are not acceptance.

Source and test inputs stayed unchanged across all final runs. The original 52-job plan was extended to 54 after two independent inventory reviews identified missing stack-50/1,000 runs of the existing construction-retention fixture. Both supplements passed on the same pin. The complete registry ran after the clean matching normal baseline, and all current diagnostics and actual runtime receipts were reconciled. Previous candidates' expensive runs supply no acceptance credit for this pin.

## Resource inventory and last-use obligations

| Resource | Owner and last required use | Failure/discard control |
| --- | --- | --- |
| Root/path/source container | holder or lazy location until exact placement capture; receiver until shape and all available placements are captured | holder drop as well as replacement; unread placement control |
| Placement/version/recovery/writer | installed placement, active capture, or unfinished publisher independently | replaced destination, repaired baseline, retired graph, late settlement |
| Receiver shell/exported argument/comparator | invocation or host output; source capture ends before native completion where copies suffice | validation failure and pending native access; host-retained output stays immutable |
| Capture/output record | local graph capture until assembly or discard, independent of required poison collection | poison plus pending siblings; source-free destinations after discard |
| Inspection/prototype/staging/failure map | boundary inspection or current import segment; failed identities weakly keyed across active segments | unformatted poison with fresh/prebuilt causes and live weak-key controls |
| External route/reservation/binding | selected native access through direct completion; registry keeps weak location | disjoint progress, competing contexts, whole-context drop |
| Identity cell/domain/query/publication | retained logical identity and unresolved comparisons; complete publication forwards/settles and detaches queries | snapshot-domain separation, merged pending cells, closed consumer, completed history |
| Operation owner/outward reject action | local work through promised processing; execution holds only pending outward reject action | local close after shared settlement; fatal before outward settlement |

## Final acceptance and evidence limits

All runs below used Node v24.14.1, Mocha 11.3.0 where applicable, strict unhandled rejections, and the unchanged final manifest. Commands, environment overrides, per-job times, result summaries, log hashes and runtime receipt hashes are retained in [phase5-acceptance.json](phase5-acceptance.json). Generated counts distinguish independent programs from delivery replays; expected language failures are checked outcomes, not failed tests.

| Gate | Final result |
| --- | --- |
| Full normal / traced suites | 5,299 / 5,299 passing |
| Complete safeguard registry | 217 witnessed entries; all current diagnostics reviewed |
| Preparation/lifecycle, 1,600 seeds | 14,528 comparison cases; 43,584 runs |
| Placement, 1,600 seeds | 6,400 distinct traces |
| Array, 1,600 seeds | 9,600 programs; 28,800 runs, including programs 1,948 and 9,345 |
| Nested, 1,600 seeds | 9,600 programs; 28,800 runs |
| External, 1,600 seeds | 9,600 programs; 28,800 runs |
| Boundary, 1,600 seeds | 51,200 histories plus 128 retirement programs; 12,928 comparison cases |
| Genuinely pending histories, 1,600 seeds | 12,800 tests; 32 checked joint keys |
| Receiving/invocation, 1,600 seeds | 152,000 histories; 240 checked joint keys |
| Full conflict matrix, all eight parts | 93,636 cases; 280,908 replays; 2,601 unique command triples |
| Publication pairs, all eight parts | 96,824 pairs and ready baselines; 290,472 non-ready comparisons |
| Lifetime/work | Normal/traced wrappers plus 26 direct GC supplements cover relevant stack limits 10/50/1,000; strict B22 direct run also passed |

The eight seeded families completed without failures or skips. All 54 jobs exited successfully with no changed inputs. Normal/traced suites include mandatory boundary intersections, two-live-execution isolation, positive/no-op loader controls, safe continue-after-failure controls, retained semantic reductions and strict B22 fault sensitivity. The complete registry uses named witnesses and full-suite fallback when needed; it is not a whole-suite-per-fault `--full` run.

The traced suite has 220 loaded process instances and 205 actual runtime executions. Ordered startup sessions distinguish reused Windows PIDs. Thirteen startup-only coordinators have 81 executed children; one startup-only process is the deliberately disabled B22 counter-loader control. The remaining raw VM browser-portability test exercises production semantics without the Node tracer and receives no traced-runtime credit. Every direct traced scale, partition, lifetime and B22 job has an actual runtime receipt.

Sensitivity review preserves narrow conclusions. The fault `property-reception-prepares-managed-state` produced thirteen intended semantic failures before a later Mocha crash while decorating a frozen FatalError; the crash and unrun variants provide no evidence. Two still-current declared selectors have no recorded failure and receive no sensitivity credit; other recorded assertions detect their guards. Counter/invariant detections are distinguished from actual GC proof. Diagnostic excerpts record omitted prefixes and truncated suffixes separately. The 217-entry mapping was reviewed in disjoint groups by the coordinator (40), complementary reviewer (90) and independent reviewer (87).

The non-author [independent review](phase5-independent-review.md) matched all 246 final files, traced the contracts and full route/resource catalogues, reviewed resulting corrections and found no remaining actionable source issue. The [surface review](phase5-surface-audit.md) reconciles receiving, dispatch, native adoption, lifetime and instrumentation. These reviews, the retained tests and the current acceptance results close B01-B22 together.

The accepted production changes are the shared Array backing producers and their ordinary masks, bounds, optional counter memberships and retirement; common receiving activation for retired prepared topology; and removal of spent Array reflection/construction captures. They preserve the existing language contracts and non-blocking issuance. The old per-successor pending producer-copy chain is removed from bounds-only derivation; no scheduler, permanent sharing, physical substitution or new semantic exception was introduced.

Confidence remains scoped to the documented contracts, bounded generators and witnessed obligations. Whole-backing retention and requested retained-output costs remain explicit representation limits; wall times are host-dependent and are not work thresholds. Promise-valued path APIs, multi-reference compiler coordination, deterministic collected-poison order and the future iterator specification retain their existing roadmap scope. These exclusions conceal no known failure through a currently supported route. Temporary investigation runners remain outside the repository; retained regressions, portable acceptance evidence and rejected-candidate history remain available.
