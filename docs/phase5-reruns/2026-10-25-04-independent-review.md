# Independent review of run 04 R1 and R2

**R1 and R2 are supported, actionable B18 findings and remain open.** I did not author their probes or any production correction. This review checks these two findings; it does not clear the other B01–B22 obligations or independently certify my own work-history probes. The newly reported R3 shared-thenable finding has a separate reviewer.

Reviewed candidate: `57f37a8ce537797856fcbae1346f27e3b43fec8f5d4ae58f413fe6876e52f88e` (256 execution inputs), Node v24.14.1. No production or test changes were made. Reviewer: `missed_history_costs` subagent; model/version not independently identified.

## R1: failed Array validation retains selected payloads

The [overflow/bounds probe](2026-10-25-04-lifetime-overflow.mjs) uses valid maximum-length sparse native Arrays for growth rejection and a two-element Array for out-of-bounds `with`. Those are supported application inputs. The expected kinds are checked: `InvalidArrayLength` or `InvalidArrayOperation`. Mutation roots are replaced with `null`, releasing their recovery state, and retained rows contain only the cleared Chain, context, poison and WeakRefs. The helper clears payload/source/argument/Promise/result bindings and returns before GC. There is no required pending input left after the explicit resolutions and task turns.

I independently reproduced **14 retaining rows out of 36** at stack limit 50: concat in all four delivery modes, and push/unshift/splice/toSpliced/with in ready and synchronous-custom delivery. Only the selected payload remains; the original source Array and its child collect. The other ten failure rows do not retain, six healthy discarded controls collect, and six healthy retained-result controls keep their payload. These are 14 affected scenarios in one finding family, not 14 distinct defects.

The author's reported heap paths match the current source closures:

- `prepareArrayReceiver` in `src/array-invocation.js:63` keeps prepared `args` in its nested `finish` function. Validation creates poison before that closure releases the successful-input Array.
- `prepareConcatArguments` in `src/array-methods.js:330` keeps `parts` in its nested `finish` closure; an overflow failure no longer needs those parts.
- `prepareWithArguments` in `src/array-methods.js:164` keeps `replacement` in the bounds callback even when the answer is invalid.

The author traced poison → lazy CallSite → these closures → `args`/`parts`/`replacement` → payload. I checked that these bindings really remain captured and uncleared at the identified source boundaries; I did not independently parse the author's heap snapshots. The distinct success-only fields can remain after the invocation owner releases its own fields, so ordinary Chain/root cleanup does not discharge this lifetime obligation.

## R2: fresh inspection causes retain remap sources

The [remap probe](2026-10-25-04-lifetime-remaps.mjs) uses observation calls (`{}` options), including methods whose names also support mutation. Required descriptor reads may therefore fail under the supported observation/receiver-preparation boundary; this is not an unread-baseline mutation experiment. The Proxy performs ordinary reflection until armed, then throws without changing its represented data. Diagnostic hit/cause state belongs to the test harness. Admission occurs before arming.

`handlerFor` is defined outside the issuing helper and closes over no Array or payload. The retained handler has only primitive flags and its cause. The probe stores no source or remap directly; source and child references in rows are weak, roots are cleared, and GC runs after every issuing helper has returned. This avoids a host test closure accidentally retaining the source.

I independently reproduced **18 retaining rows out of 54** at stack limit 50: fresh cause × first/last index for eight receiver routes, plus concat's argument route. In each affected row the Proxy, raw Array and all three children remain. All 18 prebuilt-cause rows and nine healthy discarded rows collect; nine healthy retained-result controls preserve their selected child. These are nine affected call positions, not 18 distinct bugs. Exact cause identity, `InvocationFailed` kind, source context and actual trap execution are asserted.

Every affected route reaches `createRemap` in `src/array-remap.js:72`. Its per-placement inspection callback at line 87 captures `array`; the function does not clear that binding when inspection finishes or throws. The author traced fresh cause → lazy CallSite → that inspection closure → captured Array Proxy. The source independently supports that path. Wrappers such as flat and sort already clear their own receiver bindings, which does not clear this lower shared helper's binding.

## Independent checks and limits

[My four control runs](2026-10-25-04-independent-controls.json) execute both stabilized probes at stack limit 50, normally and with only `DROP_POISONS=1`. Both ordinary runs fail at the retained-reference assertion with the counts above. Dropping only the retained poison makes **both probes pass with zero retained rows**, while contexts, cleared Chains and WeakRefs remain. This isolates completed diagnostics as a necessary retaining path and argues against execution/root retention or mere delayed GC. It is diagnostic evidence, not a proposed fix: applications are allowed to retain unformatted Errors.

The coordinator independently obtained the same 14/36 and 18/54 results both bare and traced at stack limit 1000, with actual runtime-execution receipts in [its execution record](2026-10-25-04-independent-execution.json). Its prior 28-case range regression and 12-case selected-value probe still pass on the same candidate. Those passing earlier probes establish their narrower correction; they never covered these validation/remap-source fields.

Both findings violate the explicit `AGENTS.md` lifetime requirements at lines 110–111: clear spent bindings retained by lazy Error stacks, preserve exact diagnostics, and discard success-only Array payloads once failure is known. Neither failure requires a semantic architecture decision to recognize. Any correction must preserve required argument conversion, complete poison collection, exact cause/source and pending handoffs; formatting stacks or weakening the WeakRef checks would not satisfy the contract.

No origin claim is made: I did not run these probes against an older source candidate. No production correction or correction re-review occurred in this pass. The 32 affected rows are two still-open finding families, and the 58 nonretaining/control rows do not establish that other diagnostic paths release correctly.
