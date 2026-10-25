# Independent correction review: 2026-10-25, run 02

Follow-up: this historical finding is addressed by the [run-03 correction](2026-10-25-03.md) and its [independent re-review](2026-10-25-03-independent-review.md). The original reviewed candidate and verdict below are preserved.

Status: **review complete within the focused correction scope; one actionable lifetime finding remains open. Phase 5 correction closure is not approved.**

The user requested: "Just review it, try to find issues missed the last time." This was review-only work. No production source, test, package, AGENTS.md, or pre-existing documentation was edited by this reviewer. The coordinator retained review evidence separately.

## Candidate and provenance

- Reviewer: separate Codex agent `correction_independent_review`, which did not author the production fixes. Exact backend model/build is not exposed in this session. The coordinator authored the correction and performed complementary review; discovery provenance is distinguished below.
- HEAD: `a343e41cb023d385f8bc1980ec201764c2612b84`, with the correction's existing dirty working tree. HEAD alone does not identify this candidate.
- Independently hashed all 256 entries in the [acceptance manifest](2026-10-25-02-acceptance.json), checked that `rg --files src test` contained no extra execution inputs, and reproduced SHA-256 `de3913311dd3f6718609adf5fcc2bb762d510b37fc7d106fb0d54603bc63bcc9` from compact sorted JSON. Every per-file hash matched. Repeated the manifest check after investigation: unchanged.
- Node v24.14.1, Mocha 11.3.0, Windows PowerShell; the recorded environment is Windows 11 build 26200. New probes use strict unhandled rejections. The long-history subprocess uses a 192 MiB heap cap.
- Read the local AGENTS.md, authoritative data limitations, relevant scope/error and ArrayView contracts, Phase 5 specification, audit method, rerun procedure, correction design and prior findings. Expectations below follow those contracts, not the prior pass totals.

This review concerns F1 shared captured delivery, F2 localized Array range writes and baseline/identity transfer, F3 discarded-prefix compaction, and their changed callers and lifetimes. It is not a fresh full-source audit of every B01-B22 family.

## Finding

### R1 — P2: failed range construction retains selected payloads through unformatted Error stacks

**Impact:** keeping an ordinary recoverable Error can keep otherwise discarded fill payloads or copied children, including all data reachable from them, alive after the Chain root and recovery state have been cleared. Repeated failed calls can accumulate these graphs. This violates the operation-work lifetime contract and reopens B18 in the new range path. No incorrect returned value or rollback result was established by this finding.

**Locations:** [ArrayRangeRemap](../../src/array-remap.js), particularly `this.entries` at line 18 and `createOutput` at line 22; [invokeArrayMethod](../../src/array-invocation.js), the remap closure at lines 181-190. Both the remap payload and its invocation closure require a last-use cleanup boundary.

**Supported reproduction:** use a runtime-owned Array Proxy with stable ordinary descriptors. Its element `set` trap throws before changing the requested property, after an earlier selected element write succeeded. Invoke `fill(payload, 0, 2)` with an object payload, or `copyWithin(1, 0, 2)` with object elements. Retain the resulting poison unformatted, clear the Chain root through `assignPath(chain, [], null, ctx)`, drop local input references, and run GC after event-loop turns.

Required result: all discarded selected objects collect; the exact poison/cause remain available. Observed result: the fill object and both selected copyWithin objects remain alive. The receiver, Proxy, root and untouched tail collect. Healthy discarded controls collect, while healthy live-output controls retain their data. The failure is not necessary recovery retention.

The portable [12-case reproduction](2026-10-25-02-range-selected-retention.mjs) covers both methods, fresh/prebuilt native causes, indexed/unindexed receivers, and healthy discarded/live controls. It reports **8 failing cases / 12 retained selected objects**. The coordinator reproduced limits 10 and 50; this independent reviewer reproduced the portable script at limit 1,000, and separately reproduced the extended 28-case investigation at limit 1,000. Exact commands and results are in [review evidence](2026-10-25-02-review-evidence.json).

```sh
node --unhandled-rejections=strict --expose-gc --stack-trace-limit=1000 docs/phase5-reruns/2026-10-25-02-range-selected-retention.mjs
```

The coordinator's heap investigation identified two strong paths, which agree with the inspected source and independently reproduced behavior:

1. Retained poison -> lazy CallSite -> callback closure -> `remap` -> `ArrayRangeRemap.entries` -> selected value.
2. Fresh cause -> lazy CallSite receiver -> `ArrayRangeRemap.entries` -> selected value.

The prebuilt-cause cases establish that correcting only the fresh native cause's receiver does not cover the poison closure path. Formatting both stacks lets the discarded objects collect in the coordinator's diagnostic control. **Stack formatting is evidence about the retaining path, not an acceptable runtime fix.** Preserve the exact diagnostics and clear spent runtime state at its last use.

The existing `array-range-failure-retention.mjs` uses primitive fill payload `7` and watches the raw receiver, Proxy, root and untouched tail. It does not watch the selected object payloads or copied children. Its storage-descriptor safeguard therefore detects a real but different retaining path; passing that fixture does not establish release of `ArrayRangeRemap.entries`.

This is a current supported defect on the new in-place range route. A matched pre-change failure was not established: the earlier whole-Array materialization does not execute this particular refusal on the original receiver. It is therefore not labeled conclusively as either a pre-existing defect or a regression. The coordinator first proposed and reproduced the hypothesis; this reviewer independently checked the support boundary, executed the reproduction, and confirmed the finding.

**Correction direction, not implemented:** give selected remap entries, the local entries binding captured during construction, and the invocation's remap binding explicit terminal cleanup after their publication/capture consumers have accepted them, including failure. Avoid retaining success-only payload through a method receiver or a callback closure. Recheck synchronous and pending transfers so cleanup cannot destroy a still-required copied placement. Retain selected-payload weak-reference assertions in the normal lifetime fixture with unformatted fresh/prebuilt Errors and positive controls, and add a fault that removes the actual new cleanup.

## Contract-derived route and invariant matrix

| Obligation and relevant rows | Source trace and independent expectation | Current evidence and disposition |
| --- | --- | --- |
| Program-position capture and independent destination authority — B19/B22, adjacent B01 | `shallowCopyPathContainer`, remap `placeEntry`, and `copyArrayOverlays` reach `copyPlacement`. Pending representation copies share a captured delivery, while a new destination version owns its publication. Actual readers/writers still use ordered continuations. Earlier nested writes must appear in a copy; later writers must not. | Inspected copy, transfer, queued-mutation and gate paths, including `preparePlacementCommit` invalidation of copy caches. 648 new deferred histories plus 16 ready/synchronous controls passed, with explicit expected values, cycles and alias assertions. No actionable finding in this checked subset. |
| Supersession, active registration and retired forward state — B19/B22, B01 | `recordVersion`/activation retain current copied uses; replacement/retirement release them. Independent captures retain their versions. `refreshCopiedDelivery` may update a detached version but cannot repopulate a retired destination. Cached re-entry restores maintained logical state without host inspection. | New histories export a copy, clear its holder, then complete earlier/later writers. Existing copied-delivery re-entry tests assert actual `relationshipsActive === false`; rerun passed. Inspected capture registration and restoration. Full arbitrary retired-graph exploration remains outside this focused pass. |
| Rejection source, replacement and copied recovery — B11/B13/B15/B19 | Shared delivery preserves the source version's causal poison. Superseding a pending placement must not poison the replacement. Recovery belongs to the placement, and repairing/mutating one copy cannot change another copy's baseline. | 48 new rejection cases preserve exact cause, `AssignmentValueFailed`, and writer source across reversed settlement; 12 scope-recovery cases preserve the independent restored values. Refcount verification and live execution checks passed. |
| Full rollback baseline for selected range writes — B11/B19/B22 | `run` passes the transform's preservation function to controlled range work. `preserveBaseline` temporarily removes only its own lease for ordinary COW selection, restores it before capture, then transfers protection to the complete baseline view. Changed destination overlays are captured before physical writes. A displaced gate, shared/imported/constrained storage or local overlays retain ordinary materialization. | Inspected `runMutation`, `transformProperty`, ArrayRangeRemap, representation preflight and ordinary scope publication/failure. Eight retained range-recovery tests passed, including partial storage failure, parent publication failure, holes and aliases, indexed/unindexed. No new rollback defect found. |
| Write identity without retaining a second owner — B04/B19 | Reusing receiver storage must publish a new identity for effective fill/copyWithin writes, including equal-value/self-copy writes. Empty ranges preserve identity. Earlier identity-only captures cannot be reinterpreted by address reuse. | Inspected the reused-output `IdentityPublication` integration and pending-presence publication path. All 72 retained identity cases passed across owned/view storage, three searches and native/ordered delivery, with each internally checking indexed/unindexed graphs. |
| Complete selected source capture — B17/B19 | Overlapping copyWithin captures all selected source versions before its first destination change. Pending payload movement preserves aliases; a later nested mutation splits only the selected destination. | New deferred Array histories use pending copyWithin aliases followed by nested assignment and reverse, under six settlement orders and 0/1/3 microtask splits. Explicit all-ready/synchronous controls and refcount checks agree. Existing overlap fault's precise native-equivalence diagnostic reviewed. |
| Bounded discarded prefix — B19/B22 | `tryExtendEnd` is shared by push/concat/index extension. Nonempty growth with offset greater than the current live length takes ordinary materialization; existing retained views keep their original backing. No destructive retirement compaction is added. | Inspected callers and fallback. Eleven current queue-storage tests passed, including actual collection, retained sparse views and pending captures. Saved F3 work/GC fault diagnostics reviewed. No actionable finding in this checked subset; no new exhaustive concat/index schedule product. |
| Pending-copy work and deep history — B19/B22 | Shared delivery must not replace the old triangular subscriptions with obsolete destination registrations or retained predecessor captures. Command-history depth must not become recursive data depth. | Inspected counter instrumentation and its partial/final release assertions. Reused matching 16/32/64 work evidence and separate reuse/retirement faults. Four new 10,000-step, fixed-small-graph histories passed under 192 MiB: record COW and reverse, native/ordered, then settlement and refcount validation. These are bounded stress controls, not a heap-scaling proof. |
| Last access and diagnostic retention — B17/B18 | Receiver publication, baseline retention, argument release and remap output have different final uses. Finished failure cannot retain success-only selected objects merely because its Error remains live. | Existing source/root lifetime gates are useful but incomplete. R1 demonstrates the missing selected-entry obligation and blocks closure. |
| Shared settlement versus consumer closure/fatality — adjacent B21 | Active shared publication must precede local-owner checks; an execution fatal stops it first. Dropping a local consumer cannot cancel another captured delivery. | Inspected continuation entry use and detached publication; capture-then-clear probes exercise live shared completion. Existing fatal/lifecycle gates are reused. No new complete fatal fault sweep was performed. |

The `copyPlacement` change was not treated as all transfers becoming interchangeable. Chain initialization, entry transfer, scope/repair publication, assignment and gate completion still use `transferPlacement` and retain their distinct destination/structural authority. Array overlay derivation and remap production were examined as separate copy callers. F3's common extension helper was traced from Array methods and past-length mutation, not just the changed guard.

## New execution versus reused evidence

New independent execution:

- [Copied-delivery investigation](2026-10-25-02-review-copied-delivery-extra.mjs): **648 passing cases**. Three deferred implementations (native, ordered, custom chained), six independent settlement permutations, 0/1/3 microtask splits, indexed/plain and early-observed/bare variants. Includes earlier pending nested writers, two copies, export surviving holder retirement, cycles, overlapping pending Array aliases and later reverse.
- [Rejection/recovery investigation](2026-10-25-02-review-copied-delivery-recovery.mjs): **60 passing cases**, comprising 48 exact diagnostic/replacement checks and 12 independent recovery checks.
- [Ready controls](2026-10-25-02-review-ready-controls.mjs): **16 passing cases**, all-ready and synchronously delivering thenables, using the same explicit expected values/aliases as the deferred probes.
- [Deep-copy history](2026-10-25-02-review-deep-copy-history.mjs): **4 passing cases**, 10,000 steps each, with one unresolved value on a small graph until final settlement, under `--max-old-space-size=192`.
- Focused retained tests: **99 passing**, running `test/copied-delivery.test.js`, `test/array-range-recovery.test.js`, `test/array-range-identity.test.js`, and `test/array-history-storage.test.js` through Mocha with strict unhandled rejections.
- R1: portable 12-case reproduction fails at stack limit 1,000 as described above. The extended 28-case diagnostic probe independently reproduced selected-value retention after reflection/storage failure. The storage refusal is the portable supported witness.

The **728 passing investigation cases** are additional bounded evidence, not replacements for normal-suite regressions or large generated gates. These scripts were first run independently from disposable files outside the repository. The coordinator preserved portable copies, changing import prefixes only, and reran them; those portability reruns are not double-counted. See [review evidence](2026-10-25-02-review-evidence.json) for commands, hashes and provenance.

Reused with justification: the matching [57-job acceptance record](2026-10-25-02-acceptance.json), including 5,405 normal and 5,405 traced tests, 225 safeguards, the eight required 1,600-seed families, complete conflict/publication partitions and lifetime/work supplements. The execution-input digest is identical, no new production/test edits occurred, all 57 raw saved logs were present and their hashes matched, each run recorded exit 0, the pinned digest and no changed inputs. Repeating those broad jobs would not address R1's missing assertion.

I checked the retained generated summaries beyond totals: preparation's joint ready/synchronous/native/ordered route/shape keys, receiving/invocation's 240 joint keys and explicit healthy-Error/result-effect/snapshot/query controls, and attempted/passed/failed/skipped fields. These establish those generators' bounded vocabulary. They do not establish selected-object release, every schedule, or arbitrary topology. Publication-pair normalized poison markers are not credited as exact source/cause evidence; the new rejection probe checks those separately.

I inspected the exact edits and intended failure diagnostics for all eight added safeguards, rather than counting an anchor or exit code as detection:

| Safeguard | Retained observed diagnostic | Scope qualification |
| --- | --- | --- |
| `copies-share-captured-delivery` | At N=32, 496 live captures/uses after issuance violate the bound. | Pending-copy work sensitivity, not a complete semantic proof of shared delivery. |
| `retirement-releases-copy-destinations` | At N=32, 31 captures but 496 current/peak uses violate the bound. | Separately detects obsolete registration retention. |
| `array-range-preserves-complete-baseline` | Failed fill recovery exposes written `9` instead of the earlier hole. | Complete baseline recovery witness. |
| `array-range-captures-overlapping-sources` | Native-equivalence copyWithin result repeatedly copies the overwritten value. | Actual overlap outcome, not a startup failure. |
| `array-range-bounds-point-work` | Point fill at size 64 records 8,320 placement visits. | Counter bound with its loader/control qualification. |
| `array-growth-bounds-discarded-prefix` | Completed queue retains removed payloads; queue-capacity cases also fail. | Actual collection plus bounded backing witnesses. |
| `storage-commit-drops-descriptor-receiver` | `fill/publication` keeps raw receiver object 0 alive. | Detects the spent descriptor receiver; does not cover selected remap entries (R1). |
| `array-range-publishes-write-identity` | Pending includes returns true instead of false after an effective write. | Identity-only capture, avoiding second-owner COW masking. |

The work/lifetime subprocess diagnostics include actual child fault receipts; in-process value failures have their runtime attempt receipts. The saved mapping correctly labels earlier source assessments historical and distinguishes named-witness/fallback execution from whole-suite-per-fault execution. No new safeguard fault batch was run in this review.

## Scope dispositions and limits

The matrix renews only the stated changed-route obligations of B01/B04/B11/B13/B15/B17/B18/B19/B21/B22. B18 is open through R1. B02/B03/B05/B06/B07/B08/B09/B10/B12/B14/B16/B20, and other sub-obligations of the renewed rows, retain their existing historical source assessments and current execution evidence; they were not independently re-audited in full here. Reading their contracts or observing their broad test passes is not a new source-review conclusion.

No further actionable finding was found within the checked F1/F3 ordering, value, recovery, identity and work subset. That is not exhaustive proof. The new investigations are bounded traces and semantic controls; they do not cover every interleaving, reflection site, native method, external-authority interaction, long retained-output history or source collection path. The 10,000-step cases check bounded successful completion on the tested small graphs; the instrumented work evidence remains the stronger counted claim for peak captures and registrations.

Excluded by the documented support boundary: malformed internal controls, changing admitted prototypes/primordials, non-FIFO thenables, re-entering from a thenable body rather than its supplied callback, and storage traps that mutate the requested property before refusing it. None is needed for R1 or the passing probes. Required never-settling inputs are allowed; no cancellation or timeout requirement is introduced.

**Closure condition:** correct R1, retain a regression that watches selected objects as well as receivers, run the applicable correction gates, and obtain independent re-review of that correction. The current passing evidence remains evidence for this pinned candidate's tested assertions, but cannot justify describing the candidate as clean while R1 remains reproducible.

