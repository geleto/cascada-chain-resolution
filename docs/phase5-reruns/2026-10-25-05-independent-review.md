# Independent review of the R1–R3 lifetime corrections

Status: **independent correction review and final evidence reconciliation complete; R1–R3 are closed within the focused correction scope.** All 82 current acceptance gates passed on the unchanged candidate, and no additional supported defect was found in the corrected paths examined here. This is a re-review of run 04 R1–R3 and their handoffs, not a fresh B01–B22 audit.

Reviewer: `missed_history_costs` subagent, which did not author the production fixes or their regression fixtures. Model/version is not independently identified. Candidate: `49d1a26b24b53d49915f1a67eca439754e11aa7b92d1c0ea70145179ec790c4c`, 259 execution inputs, Node v24.14.1. Every independent execution checked the fixed manifest before and after. No source or test files were changed by this reviewer.

## Last-use and handoff review

**R1 — failed validation payloads.** In `prepareArrayReceiver`, the successful argument Array is evaluated as the returned value before the local `args` binding is cleared. Validation failure needs no success-only payload; it returns the existing poison and clears that binding. When receiver snapshot assembly remains necessary, `args` stays available until its assembly callback transfers it and then clears it. The callback is a single completion, not an iterator over arguments. The correction therefore does not consume arguments before a pending shape or snapshot dependency completes.

`prepareWithArguments` similarly constructs the successful `[index, replacement]` result before clearing `replacement`; an invalid answer preserves its existing validation Error and drops the unused payload. `prepareConcatArguments.finish` constructs `{ parts, receiverRemap }` before clearing its local `parts`, or discards them after detecting overflow. Neither change clears the transferred result itself. The existing preparation owner still controls required conversion, collection and delivery.

**R2 — remap inspection sources.** `createRemap` inspects candidate placements synchronously. Every passed `inspect` function either runs the supplied action directly or through the synchronous Array boundary guard; no supported caller defers the inspection action. The resulting `PropertyPlacement` objects carry their own owner/key until capture, and captured placements carry their own versions. Clearing the helper's `array` binding in `finally` therefore removes only its spent reflection capture. It does not clear the returned remap, its lazy placements or their publication authority.

The added `concatInput` cleanup is necessary independently of that inner helper: its delivered-value callback itself captures the same Array. On success, a scalar has already transferred into `[value]`, and an Array has transferred into its captured remap/length continuation. On failure, the callback clears its source while preserving the existing poison/cause. This closes the caller route that an inner-only cleanup would leave behind.

**R3 — completed thenable source.** `thenValue` uses its original `value` to read the stable `then` and as the receiver of `Reflect.apply`. The new `finally` runs after that subscription returns or throws. Pending delivery callbacks consume their own `result`, plus their callback, operation context and shared continuation-started fact; none reads the original `value`. Synchronous delivery completes its callback before the `finally`. The change thus preserves the host protocol's `this`, callback order, returned chain, synchronous readiness, nested assimilation responsibility and throw/rejection routing while releasing the no-longer-needed subscription source.

A possible throwing-`then`-getter early exit was checked against the authoritative support boundary. `docs/data-limitations.md` explicitly excludes dynamic/throwing getters and Proxy-dependent `then` behavior. No new defense, test or finding was created for that excluded path. Existing courtesy classification of such a failure does not expand the supported lifetime contract.

## Independent execution

All **10 focused jobs passed** on the unchanged candidate; [the evidence record](2026-10-25-05-independent-evidence.json) includes exact commands, clean environment settings, script/log hashes, results, durations and actual traced execution receipts.

| Check | Bare | Traced | Distinct coverage |
| --- | ---: | ---: | --- |
| New Array validation lifetime fixture, stack 1000 | 72 pass | 72 pass | Six methods × four delivery modes × failure/discarded/live outcome |
| New remap failure lifetime fixture, stack 1000 | 72 pass | 72 pass | Eight receiver routes plus concat argument; ownKeys/first/last descriptor failures; fresh/prebuilt causes; healthy discarded/live controls |
| New deferred-validation lifetime fixture, stack 1000 | 24 pass | 24 pass | sort observation/mutation and toSorted, invalid/valid comparator, four delivery modes; payload/receiver/input WeakRefs |
| New independent handoff probe | 150 pass | 150 pass | 120 pending-shape cases and 30 external snapshot cases |
| Existing supported-thenable, Array-length and invocation-preparation tests | 150 pass | 150 pass | Current sibling semantics, including FIFO, rejection/fatal routing, shape and identity prerequisites |

Normal and traced runs repeat the same cases and are not counted as twice as many distinct scenarios. The independent 150-case [handoff probe](2026-10-25-05-independent-handoffs.mjs) adds ready, synchronous, native, ordered-custom and chained-custom delivery; both argument-first and shape-first completion; created/absent pending indexes; sparse outputs; exact validation source/kind; and external-snapshot alias preservation. Every operation result enters a Chain immediately at issuance, before readiness changes, awaits or task turns. The original returned result still supplies the pending-completion assertion. Later value checks consume that holder; mutating calls separately verify the receiver and native return value. The parent/storage/refcount verifier and fatal-state assertions pass.

An exploratory version of that probe constructed its expected value by reading the original physical Array after concat had legally extended shared backing. That is not the earlier logical Array value. The final oracle instead starts from the issued logical `[1, , 3]`; every accepted handoff execution uses that logical-input oracle. This was a harness correction, not a runtime finding or an accepted change in semantics.

The coordinator then identified a separate harness defect: the first recorded handoff runs delayed attaching a receiving holder across awaits/task turns, and the snapshot branch awaited even ready raw results. Those two executions have been moved into `supersededExploration` in the evidence record and supply no supported-handoff acceptance credit. Both corrected jobs were rerun with immediate Chain reception and passed all 150 cases; their script hash is `bd25dfe3f43e8fef7820ff790868447a409ea81c6de785e4e90af932e4edd6cf`. The other eight focused jobs are unaffected. The accepted inventory remains ten jobs, with these two replacing the earlier handoff executions.

The new lifetime fixtures retain unformatted poisons and exact causes while clearing source holders. Their host Proxy handlers are created outside the issuing scope, so they do not close over tested sources. Healthy retained outputs remain positive controls; successful results are also compared against native value/hole behavior. The deferred comparator fixture does not attach the tested payload as an extra property on its source signal. These checks address the previously identified harness risks rather than merely asserting that a weak root disappeared.

## Final acceptance reconciliation and scope limits

The [final reconciliation record](2026-10-25-05-independent-reconciliation.json) verifies all **82 current acceptance jobs**: unique completed labels, exit zero, unchanged before/after candidate, current log hashes, additional probe hashes and every applicable trace receipt. I recomputed the complete 259-input manifest digest from current bytes, including its file inventory. The [acceptance record](2026-10-25-05-acceptance.json) embeds the current independent evidence unchanged, retaining ten accepted independent jobs and excluding the two superseded handoff executions. No broad gate was reused from an earlier candidate.

The normal and traced suites both pass **5,414 tests**. Raw traced receipts establish **237 loaded process instances and 220 actual execution instances**; the 17 loaded-only controls receive no execution credit. All eight 1,600-seed generated families pass with their generator-specific program, history, replay and comparison units preserved. The full eight-part conflict matrix passes **93,636 cases / 280,908 executions**. The eight publication-pair partitions pass **96,824 pairs**, each with a ready baseline, and **290,472 nonready comparisons**. Their `modeledFailures` counts are intentional failed-publication scenarios, not test failures.

The matching clean normal baseline finished before the `--skip-baseline` safeguard run. All **232 registry entries** were witnessed, and all **226 earlier failed-test sets remain unchanged**. The six new faults have complete diagnostics matching the raw report hashes and receipts from actual GC children, distinct from their Mocha parent. Each reaches the retained-reference assertion in the intended fixture:

| Removed cleanup | Retaining scenarios under that fault | GC child PID |
| --- | ---: | ---: |
| Prepared Array arguments | 8 | 7196 |
| `with` replacement | 2 | 33772 |
| Concat prepared parts | 4 | 15492 |
| Remap inspection source | 18 | 11156 |
| Concat delivered input source | 3 | 18940 |
| Thenable subscription source | 6 | 36284 |

These per-fault scenarios overlap existing regression matrices; they are not added into a distinct-case total. Registry evidence uses named witnesses/fallback, not whole-suite-per-fault execution. Startup failures and unrelated later crashes receive no additional detection credit.

The run 04 work-history supplement passes **144 histories with its own eight-counter loader**. Its current result/log/probe hashes and zero final measured captures/use memberships are verified. The publication tracer is incompatible with that exact-anchor counter loader; its earlier composition attempt failed at startup and remains explicitly superseded. The accepted replacement has `NODE_OPTIONS` unset and receives no publication-tracer execution credit. That qualification does not invalidate the executed probe-owned counters or relax their bounds.

Within the inspected paths, the changes remove the established source/argument retaining edges while leaving destination ownership, versions, required pending work and Error identity intact. No unresolved correction finding or required acceptance gate remains. This approval does not claim every diagnostic frame in the runtime releases correctly, or classify unrelated unexamined B01–B22 routes as clean. The broader source-audit exclusions and the preserved harness corrections remain material limits on the conclusion.
