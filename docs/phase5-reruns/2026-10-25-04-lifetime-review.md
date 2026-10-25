# Missed failure-lifetime review, run 04

Status: **review findings remain open; no production or test changes made.** This is a focused B18 investigation of selected inputs and remap sources retained by completed failure diagnostics. It is not a full B01–B22 review or an implementation acceptance run.

Reviewer: `/root/missed_failure_lifetimes`, separate source-review agent. Exact model version is not available to this agent. Execution inputs match the run 03 candidate: 256 files, digest `57f37a8ce537797856fcbae1346f27e3b43fec8f5d4ae58f413fe6876e52f88e`. Node v24.14.1. The [evidence record](2026-10-25-04-lifetime-evidence.json) records the environment, probe hashes, exact commands, outputs, diagnostics, and heap paths.

The governing obligation is in [AGENTS.md, Operation Work Lifetimes](../../AGENTS.md#operation-work-lifetimes): completed work must release spent input captures, including captures kept alive by unformatted Error stacks. The review distinguishes operation captures from a still-needed mutation recovery baseline, a retained output, and an application-held native Promise. Every failing case clears the Chain root; only its execution, cleared Chain, WeakRefs, and unformatted poison remain retained by the harness.

## R1 — Validation diagnostics retain discarded Array payloads

**P2, supported reproduction.** A failed `with` bounds check keeps its replacement object alive. Array length overflow similarly retains inserted payloads for `concat`, `push`, `unshift`, `splice`, and `toSpliced`. The source Array and its unrelated child collect, so watching only the receiver would miss the failure.

The [portable validation probe](2026-10-25-04-lifetime-overflow.mjs) exercises six methods through ready, synchronous thenable, native Promise and ordered thenable input delivery. Each method also has a healthy discarded-output control and a live-output control. At stack limits 10, 50 and 1,000, 14 of 24 failure cases retain payloads; all twelve healthy controls behave as expected:

| Route | Retaining delivery variants |
| --- | --- |
| `with(3, payload)` on a two-element Array | Ready and synchronous thenable |
| `push`, `unshift`, `splice(0, 0, payload)`, `toSpliced(0, 0, payload)` at maximum Array length | Ready and synchronous thenable |
| `concat(payload)` at maximum Array length | All four variants |

The overflow source is a sparse native Array with length `0xffffffff` and one present placement; the probe does not create or enumerate billions of values. The smaller `with` reproduction requires no large length. These are ordinary validation failures, without Proxy traps or host mutation.

Strong paths independently extracted from V8 heap snapshots are:

- Growth validation: `PoisonError → lazy CallSiteInfo → finish closure → context.args → prepared Array → payload`. The closure belongs to `prepareArrayReceiver` in `src/array-invocation.js`.
- Concat validation: `PoisonError → lazy CallSiteInfo → callback context.parts → part Array → payload`, in `prepareConcatArguments` in `src/array-methods.js`.
- Bounds validation: `PoisonError → lazy CallSiteInfo → finish.context.replacement → payload`, in `prepareWithArguments` in `src/array-methods.js`.

The authoritative correction should end these local captures at the failed-validation or successful-handoff boundary, while preserving arguments still needed for pending shape/snapshot work. Clearing `InvocationWork.args` alone does not clear these separate closure bindings. Stack formatting is diagnostic evidence only, not an acceptable correction. This review did not implement or validate a fix.

## R2 — Fresh remap inspection failures retain their source graph

**P2, supported reproduction.** `createRemap` invokes an inspection closure capturing its `array` parameter and does not clear that binding when the walk returns or throws. A fresh host Error created during the read retains the closure through its lazy stack, keeping the source Proxy, its raw Array and all selected children alive after the operation and root release.

The [portable remap probe](2026-10-25-04-lifetime-remaps.mjs) explicitly imports a Proxy-backed Array, completes admission, then arms a descriptor-read failure for the first or last of three present indexes. All calls are **observations**, including names such as `reverse` and `splice`; no mutation-selection descriptor is made unreadable. Traps leave the represented graph unchanged, preserve ordinary native Promise safety, and do not capture the source in the host handler. Every poison preserves the exact cause, operation source and `InvocationFailed` classification, with no execution fatal.

The 54 cases cover eight receiver routes (`concat`, `reverse`, `splice`, `toReversed`, `toSpliced`, `sort`, `toSorted`, `flat`) plus a prepared Array argument to `concat`; each route has first/last read failure × fresh/prebuilt cause, healthy discarded output and healthy retained output. All 18 fresh-cause failures retain the source and three children at stack limits 10, 50 and 1,000. All 18 prebuilt-cause failures and all 18 healthy controls behave as expected.

The extracted path is `PoisonError.cause → fresh Error lazy CallSiteInfo → inspect closure → context.array → JSProxy → raw Array/children`. Its source is the per-placement inspection in `src/array-remap.js:createRemap`. Existing `test/fixtures/array-reflection-release.mjs` uses a prebuilt cause, so its broad method list did not exercise this source-retaining native stack.

The primary fix should clear the remap source binding after synchronous capture, including exceptions. The argument route must also check the enclosing `concatInput` value capture; removing one proven path is not proof that a second path is absent. No new copying, ownership scheme or stack rewriting is warranted. A future regression should retain both fresh and prebuilt causes while tracking selected children as well as their container.

## R3 — A deferred validation Error retains a settled continuation dependency

**P2, supported reproduction with broader callers not yet measured.** A native or ordered thenable delivers an object as an invalid Array sort comparator. The call returns `NotAFunction`, and its receiver can collect after root release, but the delivered object stays alive while the unformatted poison is retained. Ready and synchronous delivery of the same invalid object do not retain it.

The [preparation sibling probe](2026-10-25-04-lifetime-preparation-controls.mjs) has twelve cases: invalid comparator, invalid numeric `fill` input with a separate payload, and `concat` with a successful earlier payload followed by poison; each uses the four delivery variants. Only the two deferred invalid comparator cases retain their payload, at all three stack limits.

The heap path is `PoisonError → lazy CallSiteInfo → delivery closure → context.previous → context.value → settled Promise → result object`. The closure's V8 SharedFunctionInfo identifies **`src/language-values.js`**. In `thenValue`, the thenability probe captures the source `value`, and the `deliver` callbacks share its surrounding lexical context. The source binding remains after subscription, although the later delivery callback uses its own `result` argument. A validation Error created during that callback can therefore retain the already-spent Promise and its fulfillment graph.

The subsequent [independent review](2026-10-25-04-delivery-lifetime-review.md) watches the original host input separately and proves it collects. The retained `thenValue` source is a settled **intermediate preparation Promise**. Its separate harness also reproduces the defect for mutating `sort` and observational `toSorted`; that expansion is recorded separately from this probe's twelve cases.

This is distinct from R1's local prepared-argument captures and R2's source inspection capture. It suggests clearing the subscription source once registration has handed off its callbacks, preserving synchronous-thenable exception semantics. That is a source-derived correction direction, not a validated implementation. Other callers of this shared helper were not exhaustively tested here; they require a broader sibling review during correction.

## Evidence, limitations and coverage gaps

For each final probe, three plain runs (stack limits 10, 50, 1,000) reproduce its stated failures. A poison-drop-only run releases every otherwise-retained object. A separate stack-formatting diagnostic also releases them. That gives fifteen recorded execution jobs, nine intentionally failing and six diagnostic controls. The report does not count an expected failure as a passing invariant check. Five additional heap investigations retain their exact paths, closure/script attribution, snapshot sizes and SHA256 values in the evidence record; bulky snapshots remain temporary diagnostic artifacts, and the portable probes can reconstruct the failures without them.

The observed roots were ordinary prepared inputs, public operation calls and retained poisons. The snapshot path search excludes weak edges and starts at the poison, so it does not mistake a harness WeakRef or a metadata weak key for the retaining path. Healthy results are handed immediately into a holder when retained; discarded source holders are explicitly cleared. The earlier R1 correction in `ArrayRangeRemap` was not modified.

These findings have not been assigned a baseline-regression origin: this pass did not execute them against an earlier source checkout. No passing global suite is used to override their direct reproductions. No claim is made here about every nested partial-remap failure, every pending-poison collection frontier, mutation publication failures, managed native callbacks, or all users of `thenValue`. `map` is not in the current controlled Array method table. Those are explicit coverage limits, not cleared obligations.
