# Independent R1 correction review: 2026-10-25, run 03

Status: **complete within the focused correction scope; R1 is closed on the verified candidate.** This is a focused re-review of the selected-value lifetime correction. It does not replace the historical full Phase 5 source audits.

## Candidate and independence

The reviewer is the separate Codex agent `correction_independent_review`, which identified the prior correction's disposition and did not author this production fix. Exact backend model/build is not exposed. The user authorized fixing actionable issues; this reviewer made no production, test, package or AGENTS.md changes.

Independently verified the 256-entry manifest at `C:/Users/Gele/AppData/Local/Temp/cascada-phase5-fixes-20261025/acceptance-3/initial.json`, reproduced digest `57f37a8ce537797856fcbae1346f27e3b43fec8f5d4ae58f413fe6876e52f88e`, and found no per-file mismatch or extra src/test input. HEAD remains `a343e41cb023d385f8bc1980ec201764c2612b84`. A second verification after the targeted probes reproduced the same digest.

Compared with reviewed candidate `de3913311dd3f6718609adf5fcc2bb762d510b37fc7d106fb0d54603bc63bcc9`, exactly four execution inputs changed: `src/array-remap.js`, `test/fixtures/array-range-failure-retention.mjs`, `test/safeguards/registry.mjs`, and `test/README.md`. The production delta is the explanatory comment and `this.entries = undefined` at [array-remap.js](../../src/array-remap.js), before fallible construction. Removing exactly those two comment lines and the assignment reconstructs the prior source SHA-256 `86207da2065eb563d76917b38a875e1c596efb6410537bf505868050bd9af441`, independently verified against run 02. The inherited runtime, support-boundary and lifetime contracts remain unchanged. Environment: Node v24.14.1, Mocha 11.3.0, Windows PowerShell on the recorded Windows 11 build 26200.

## Source and lifetime argument

The [previous R1 finding](2026-10-25-02-independent-review.md) demonstrated two retaining paths: the saved `ArrayRangeRemap` receiver and the invocation closure retaining that carrier. Both reached selected application objects through `carrier.entries`.

The corrected handoff selects `start`, `entries` and `length` into locals and clears the carrier field before inspecting selected source placements, checking storage eligibility, capturing a baseline or writing any destination. Thus a saved receiver or caller closure may retain the small spent carrier without retaining its selected values. The required local entries remain available throughout construction.

I challenged the single-use assumption through the actual producers and consumer:

- Only controlled `fill` and `copyWithin` construct `ArrayRangeRemap`.
- `invokeArrayMethod` has the only `createOutput` call. Neither it nor its result/identity handling reads `entries` afterward. The controlled continuation calls the method once; there is no retry of the same carrier on failure.
- `createOutput` completes its construction synchronously. Its nested baseline/inspection callbacks capture bounds, context and source as required, but do not reference the local `entries` binding or reread the carrier field.
- In-place work captures overlapping source versions, establishes the complete baseline and transfers each selected placement before returning. Pending values are installed into independent destination versions by `copyPlacement`/`transferPlacement`; their later callbacks own their delivery, not the original range carrier.
- The materialization fallback constructs its own remap from the captured local entries and finishes destination construction synchronously. It does not defer a read of `ArrayRangeRemap.entries`.
- Empty mutation fill/copyWithin paths return before making a useful selected-entry carrier. A no-write sparse copy has no selected application values to preserve; pending presence uses the ordinary publication path. Reusing a consumed internal carrier directly would be unsupported integration misuse, not a reason to retain its payload.

This is an operation-private reference handoff. It changes no traversal, storage operation, version authority, identity decision, scope rollback, Error attribution, thenable subscription or scheduling. It introduces no copy, lease, registry, fallback or stack formatting.

Clearing only the carrier is sufficient for the demonstrated paths because the local `entries` binding is not captured by the nested callbacks. The proof is specific to this implementation: a later change that captures that local or adds deferred/repeated carrier use would require revisiting its lifetime. There is no general claim that clearing an object's field releases all other captures.

## Independently executed checks

All clean runs below used strict unhandled rejections and unchanged candidate bytes.

| Check | Result | What it establishes |
| --- | --- | --- |
| Original portable 12-case R1 reproduction, stack limits 10, 50 and 1,000 | All three passed: `failures: []`, unformatted stacks, two live controls each | The previously confirmed supported storage-refusal defect no longer retains fill payloads or selected copyWithin children. |
| Expanded existing 28-case range-failure fixture, limits 10, 50 and 1,000 | All three passed with original source/root/tail and selected-value assertions, two live controls each | Release across the fixture's reflection, partial-storage and parent-publication exits; exact cause/source and legitimate live retention remain intact. |
| In-memory removal of only `this.entries = undefined`, direct 1,000-frame fixture | Intended failure: `fill/reflection/false/false/false retained selected value 0`; runtime fault receipt for `src/array-remap.js`, PID 22500 | The strengthened assertion detects the corrected retaining path rather than a startup failure. On-disk source was unchanged. |
| [Independent carrier-handoff probe](2026-10-25-03-range-carrier-handoff.mjs) | 80 passing cases, no fatal or refcount inconsistency | Pending fulfillment/rejection survives carrier consumption and later holder clearing, in observation and mutation mode across owned/imported/shared/view/overlay storage. |

The handoff probe varies both methods, native/ordered delivery and fulfillment/rejection. Each result is received into a Chain immediately, export captures its placements, and every source/result holder is then cleared before delivery. Fulfillments retain the specified values and aliases; rejections retain the exact supplied cause. This specifically challenges accidental early release when no later consumer may depend on the carrier field.

The probe was first executed independently outside the repository at `C:/Users/Gele/AppData/Local/Temp/cascada-independent-r1-review-20261025/range-carrier-handoff.mjs`, SHA-256 `5e3bfb1332bb9edd23c5345575834eeba5fb1971a1d1db905035378759959efa`. The coordinator preserved the linked portable copy with relative imports. Coordinator reruns are not additional independently authored cases.

Reproduction commands for the clean lifetime checks:

```sh
node --unhandled-rejections=strict --expose-gc --stack-trace-limit=1000 docs/phase5-reruns/2026-10-25-02-range-selected-retention.mjs
node --unhandled-rejections=strict --expose-gc --stack-trace-limit=1000 test/fixtures/array-range-failure-retention.mjs
```

Repeat with `10` and `50`. No `--diagnostic-format-stacks` option was used for acceptance. The prior run-02 finding and failing evidence remain historical and are not rewritten as passing results.

## Evidence reuse and acceptance boundary

The [rerun procedure](../prompts/phase5-rerun.md) permits justified reuse of unaffected expensive evidence after a local correction. This production change is not another shared transition or representation redesign: it removes an operation-private retaining edge after the only consumer selects the contents, while every semantic use of those contents remains unchanged.

I agree with the selected boundary: newly execute normal/traced suites, the changed fixture at all required stack limits, the new fault and complete current safeguard registry, affected Array exploration, and the lifetime/work supplements and retained focused probes. Reuse the other seven large generated families and the complete conflict/publication-pair partitions from [run-02 acceptance](2026-10-25-02-acceptance.json), with their original candidate/date and limits explicitly retained. Their runtime scheduling, authority, version, publication and identity mechanisms, generators, models, oracles and loaders are unchanged. Current broad suites and Array exploration exercise the changed caller; the changed regression and exact removal fault establish sensitivity to its new lifetime obligation.

The old generated passes are not evidence that R1 was already fixed. Their assertion vocabulary omitted selected-object release. The strengthened regression, successful original reproduction and new removal fault supply that missing evidence. A change that reused carriers, captured `entries` into a deferred callback, changed transfer/publication, or altered a generator/oracle would invalidate this narrow reuse argument.

Final reconciliation of [current acceptance](2026-10-25-03-acceptance.json) found **42/42 newly executed jobs successful** on the unchanged pin: 5,405 normal tests, 5,405 traced tests, all 226 safeguards, the 1,600-seed Array family (9,600 programs / 28,800 runs; zero failures or skips), and 38 direct lifetime/work/regression/review jobs. All 42 saved logs were present and hash-matched; all jobs recorded exit 0, the current candidate digest and no changed inputs. Every applicable receipt file also hash-matched, with actual runtime execution rather than loader startup alone. The traced suite retains its explicit negative-control qualification (228 loaded process instances, 211 runtime executions).

The [current sensitivity record](2026-10-25-03-sensitivity.json) contains 226 witnessed entries. I independently compared all 225 earlier failed-test sets with run 02: none changed. The raw safeguard report hash matches, and the new removal fault reaches the exact selected-value failure in child PID 37380 with its source-fault receipt. This complements the independent direct fault run above. The registry remains named-witness/fallback testing, not whole-suite-per-fault execution.

The 23 reused jobs remain explicitly attributed to the previous candidate. Their source acceptance artifact hash matches the new record, and the production-delta reconstruction above confirms the dependency argument against actual bytes. The 80-case independent handoff probe is separately recorded, without a tracing claim or duplicate credit for the coordinator's portability rerun. A final source/test/AGENTS/package hash check again reproduced the 256-file current digest.

## Disposition and limits

**R1 is corrected within the checked scope. No further actionable finding was found in this re-review.** The new selected-value fixture and removal fault cover the previously missed B18 obligation; the former descriptor-receiver safeguard remains separate because it protects a different retaining path.

This conclusion covers the carrier handoff, its current callers, deferred placement consumers and tested failure lifetimes. It is not an exhaustive GC proof, a new full B01-B22 source audit, or acceptance of unsupported storage/thenable behavior. The current source, targeted re-review and reconciled acceptance evidence support closure of this R1 correction on the pinned candidate. No additional gate or architecture decision is required for this scoped correction.


