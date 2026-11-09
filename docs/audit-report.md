# Whole-project audit and repair

Completed 2026-11-06 at `ed1e3e1`; follow-ups verified through 2026-11-09.
The current normal suite passes **6,294 tests**. D01 is implemented; D02 and
D03 confirm existing behavior. D04's producer experiments were tried and reverted.
D05 is resolved by the decision to await upstream dependency fixes. No required
audit work or user decisions remain.

The responsibility ledger covers C01-C15, all 35 public exports and S1-S8.
The inventory retains the original 350 files and seven follow-up additions.
Current contracts remain in [data limitations](data-limitations.md); verification
records below identify the revisions and limits behind each result.

## Accepted residual risk

### D05 - Await upstream dependency fixes

**Rechecked 2026-11-09; development-tool risk.** `npm audit` still reports three
moderate package entries for two advisories. The affected dependency chain is
`mocha@11.3.0 → glob@10.5.0 → minimatch@9.0.9`; Mocha's separate direct
`minimatch@5.1.9` is outside this advisory's affected range.

- `glob` can continue filesystem work after an asynchronous search is cancelled.
  The fix requires 14.0.2+. [Advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4).
- `minimatch` can amplify specially crafted patterns into excessive CPU/memory
  work under the affected optimization mode. The fix requires 11.0.1+.
  [Advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

These packages locate test files; Cascada's runtime does not use them. The project
has no production dependencies, and `npm audit --omit=dev` reports zero findings.
The inspected runner uses synchronous discovery without AbortSignal and trusted
fixed patterns, so no triggering path was found in the current test commands.
The installed versions remain affected even when those conditions are absent.

The registry's latest Mocha is 12.0.3, whose
[manifest](https://github.com/mochajs/mocha/blob/v12.0.3/package.json) still requests
glob 13 and minimatch 10. An ordinary Mocha upgrade therefore does not clear these
advisories. **User decision, 2026-11-09:** retain the current runner and wait for
upstream releases that integrate patched dependencies. Do not force major-version
overrides or migrate the runner for this audit. The documented development-only
audit warnings remain accepted pending that maintenance update; this is not an
unfinished audit action. Recheck the dependency chain when adopting an upstream
fix and validate the runner's file discovery and complete suite at that time.

## Resolved decisions

### D01 - Exact-path status repair implemented

Placement versions hold current data and optional own failure metadata; Error
diagnostics hold no recovery payload. Repair clears only the selected managed or
canonical external path's own status. It preserves data, descendant status and
historical captures, and returns `undefined`; ordinary Error data remains data.
Failed managed native working state is discarded before adoption. External
effects remain. Repair-and-call performs structural preflight, clears own status,
then checks receiver availability and descendant blockers under ordinary ordering.

This removes repair-only predecessors, preservation-parent links and their
retention callbacks. Ordinary parent relationships, COW and captured versions
retain data needed by other owners. Pending status successors reuse the payload
producer with independent destination status and publication authority.

The review followed all 18 changed production modules through preparation,
publication, mutation/entry, capture/query, external metadata and Array consumers.
The [status tests](../test/status-repair.test.js),
[work](../test/fixtures/status-repair-work.mjs),
[retention](../test/fixtures/status-repair-retention.mjs), and
[placement regressions](../test/placement-version-boundaries.test.js) cover own
versus child status, repeated flags, pending data, no-op identity, record order,
discarded native work and released data with unformatted diagnostics retained.
Verification is recorded in [the D01 manifest](audit-d01-verification.json).
Streaming modes and positional policies remain in the separate future plans.

### D02 - Context import already registers the compiler's external resource tree

**Existing behavior confirmed.** Initial `ContextChain` import filters the
compiler's finite mutation access tree by the admitted categories, validates all
directly available external locations and commits registration atomically.
Managed endpoints remain managed. A copied branch gains no external authority,
even before the canonical location's first use.

The remaining timing case is an alias operation started *before context import*.
If it waits while a retained root, intermediate identity or receiver becomes
registered, continued native access must fail. One context initialized before
commands already avoids this race; retain the post-wait checks for the kernel's
supported later initialization. [External path tests](../test/external-paths.test.js),
[binding diagnostics](../test/external-binding-diagnostics.test.js), and
[receiving tests](../test/receiving-paths.test.js) cover these boundaries.

### D03 - Imported managed originals are protected; owned storage remains writable

**Existing behavior audited; no violation found.** Imported host originals remain
unchanged. Path writes and mutable entry copy imported containers; Promise
settlement leaves imported physical slots untouched; Array sharing/extension
excludes imported backing; managed native calls assemble detached receivers and
protect newly adopted host identities. Exports and mutable-resource snapshots
write fresh shells. Physical writes target runtime-owned storage, never a changed
copy's imported source. Host-owned objects must enter through import or
`ContextChain`; direct `Chain` construction assumes runtime ownership.

The [30 imported-storage cases](../test/imported-storage.test.js) record every
physical write attempt and check original descriptors alongside changed logical
outputs. They cover four receiving routes, ready/native/ordered delivery, sole
and retained owners, mutation/entry, Arrays, snapshots, native success/failure,
repair and adopted host data. Disabling imported COW, Promise-cache protection,
or adoption protection in isolated in-memory fault controls caused respectively
14, 8 and 2 write-attempt failures. No production change was needed, and no
all-overlay storage redesign is selected.

### D04 - Query completion simplified; producer redesign remains unproven

**Query simplification retained.** `observations.js` now uses one operation-local
pending-part counter instead of recursive wait arrays and `Promise.all` trees.
Existing early `hasError`, complete `getErrors`, publication and release duties
remain intact. The [query regression](../test/query-frontier-work.test.js) and
[GC fixture](../test/fixtures/query-frontier-work.mjs) retain the causal checks:
the old implementation fails the retention bound, and a disabled Promise tracker
fails its independent control.

For 16/64/128 successively delivered nodes with one final dependency unresolved,
retained `hasError` Promises fell from 82/273/529 to 18/17/17; `getErrors` retains
17 at each size. This is a retention improvement, not a universal allocation or
speed claim: a separate 64-leaf query allocates 329 Promises versus 268 before.

**Producer experiments completed and reverted, 2026-11-09.** An isolated checkout
matched all 357 working-tree inputs before the trials; the original source and
staged changes were untouched. Two implementations were compared:

- **Shared one-shot producer through ordinary publication:** replaced the separate
  delivery loop with the existing placement/capture transition. All 558 focused
  tests passed, but all 36 work scenarios had identical capture, subscription and
  active-destination counts. It retained every destination-lifetime obligation,
  added a callback per pending copy and removed no helper (52 functions; 839 ? 840
  module lines). Reverted for no demonstrated simplification or work benefit.
- **Direct subscribers to the shared producer:** removed the copied-destination
  membership protocol and its activation/retirement hooks, routing copies through
  ordinary transfer. It removed 60 module lines, but the unchanged status-history
  test failed: spent repairs retained pending captures. The other 555 focused
  cases passed. In the 36-case copy fixture, all final outputs and release checks
  passed, while 30 cases exceeded the live-capture bound and 26 exceeded the
  subscription bound. The removed membership metric had no counterpart; live
  capture/subscription instrumentation and bounds were unchanged.

| Pending record writes | Existing live captures / subscriptions | Direct-subscriber trial |
| --- | --- | --- |
| 16 | 16 / 64 | 168 / 520 |
| 32 | 32 / 128 | 592 / 1,808 |
| 64 | 64 / 256 | 2,208 / 6,688 |

The measured history growth comes from obsolete destinations retaining ordinary
continuations until the shared source settles. Restoring last-use removal needs
an equivalent lifetime mechanism. Retain the current implementation; these trials
do not establish that every possible immutable-producer design is impossible.
After restoring all candidate files, all 357 input hashes matched the baseline
and the same 558 focused tests passed, including pending-copy and status bounds.
No production code or tests from either trial are retained. The prior 6,294-test
full-suite result remains applicable to the unchanged runtime; these focused
trials are not a new full-audit acceptance.

## Baseline and evidence policy

- Original baseline: clean `b4de642b672e4c1e10ca4589bb8d0b26344160ba`,
  **6,189 passing**. Environment: Windows/PowerShell, Node `v24.14.1`, npm
  `11.11.0`, Mocha `11.3.0`.
- The original [verification manifest](audit-verification.json) records 299
  execution inputs, commands, settings, results and qualifications. Its digest
  is `e13a13c39008865c1bfe373ed058d6d0577f6db2a37337f47c3b360e5afba5a3`.
- D04 starts from clean `ed1e3e1f9b91976ec62f75879f3edd07a28a445f`; its verified
  `observations.js` SHA-256 is
  `d778bf42f28479c7510bacd266e2985d08ab7354d1a53ea090c7da4b27b81276`.
- D01 starts from clean `d91f1bd825620c25238c2c901497ea6e03d7faa4`.
  Its [manifest](audit-d01-verification.json) records 301 execution inputs with
  digest `ed381368378e95ef735c41347aafe7d91559a42bc6427cd5032244e293816c6b`.
  D02/D03 added tests and documentation; production hashes still match D01.
- Older Phase 4/5 records remain evidence for their named candidates. They are
  neither repinned nor presented as fresh acceptance of subsequent changes.

## Fixed findings

| ID | Finding, correction and causal evidence | Validation |
| --- | --- | --- |
| A01 | Safeguard `--parallel=0`, malformed, negative or fractional values could run no jobs and exit successfully. Require a positive safe integer; allocate at most the selected job count. | Six invalid-worker controls pass; the original five fail before/pass after, and the sixth rejects a trailing malformed value. A real safeguard with `9007199254740991` workers requested executes both intended witnesses without excessive allocation. |
| A02 | A reporter `end` with zero failures masked unsuccessful baseline process exit. Require completed reporting, zero failures, exit 0 and no signal. | A retained actual-child loader emits `end` then exits 1; repaired runner exits 2 before any fault experiment. |
| A03 | Manifest and lockfile root declared ISC while LICENSE is BSD 2-Clause. Correct both to BSD-2-Clause. | Root metadata and dependency integration inspected; package checks recorded in the original manifest. |
| A04 | Finite cyclic flat overflowed the stack or lost depth residue; shared empty DAGs repeated preparation exponentially. Replace per-depth recursive remaps/native flat with one capture per physical Array and bounded graph/output processing. | 312 bounded finite cases; 179 focused tests; 30 flat completion/GC cases; 11 work rows and inactive-instrumentation controls; independent capacity oracle 5,600 cases. Causal proof below; full evidence in the original manifest. |
| A05 | Generated numeric settings and shards could select zero cases or accept malformed values; matrix mode typos silently selected another mode. One shared validator now rejects invalid/empty coverage selections, including direct receiving-differential invocation and safe derived program indexes. | Retained subprocess controls exercise actual CLI paths, range/shard bounds, seed minimums and continuation/deadline settings. Expanded runs use valid non-empty settings; source provenance is qualified in the original manifest. |
| A06 | Work counters and admission observers could yield green zero-work evidence; lifetime method/prefix selectors could execute no cases. Require executed positive controls and nonempty selections. | Disabled counters with loaders still installed fail for Array enumeration, length, pending-copy and history-work; preloaded runtime fails the admission witness; unknown retention selectors fail. Healthy fixtures pass. |
| A07 | Some tests relied on raw managed results across later commands, direct managed transfer across executions, post-admission host mutation, fabricated runtime fatals, unreadable required mutation baselines or Proxy refusal of runtime-owned Array length growth. | Immediate holders, independent imports, stable pre-admission setup, real cross-execution fatal propagation and supported imported-storage failure routes now test the intended semantics. Removed only excluded malformed integration/native-slot-class cases. Positive controls remain. |
| A08 | A receiving-order assertion waived earlier poison preservation for one import failure route; two export lifetime sites waived source collection. | Removed the waivers. Receiving-order cases and GC source-release controls pass. A live raw Array output fixture now holds it explicitly and separately proves collection after release. |
| A09 | Several Mocha parent deadlines were shorter than or equal to bounded child deadlines, hiding useful child diagnostics under load. | Parent deadlines now include child completion/cleanup margin; strict child process and heap limits remain. Focused wrappers pass. |
| A10 | Reusable historical probes had stale duplicate-binding expectations and an obsolete work-counter source anchor. | Coordinator now expects atomic duplicate rejection and original-binding preservation: 36 histories pass. Updated history anchors and shared instrumentation compose with tracing: 144 histories pass normally and traced; inactive-counter controls fail in both modes. |
| A11 | Current API/design prose contradicted healthy native Error data, complete prepared-result preservation, detached native receivers, source-lease last use, first-valid binding, metadata-only repair, Promise keys and completed N2/B22 status. Future Array design probes also used stale oracles. | Corrected current statements and executable design probes; preserved dated evidence and explicit future cutovers. Historical records remain identified by their original candidate. |
| A12 | The development lockfile retained vulnerable compatible releases. Update brace-expansion 2.1.1 to 2.1.7, js-yaml 4.3.0 to 4.3.2 and serialize-javascript 7.0.7 to 7.1.4 without changing direct dependency ranges. | `npm audit fix --package-lock-only --ignore-scripts` reduces six reported package entries to the three moderate entries in D05; `npm ci --ignore-scripts` and `npm ls --all` pass; production-only audit reports zero advisories. Both final full suites pass. |
| A13 | Two fault substitutions broke work-counter anchors, and the safeguard classifier counted the resulting instrumentation failure as a semantic witness. Preserve instrumentation anchors in the mutations and classify `Runtime counter anchor` as infrastructure failure. | Independent inspection found both exact false witnesses in the partial registry run; that run was stopped and retained as superseded evidence. Both exact classifier controls fail before/pass after (16 focused passes). The repaired faults produce actual work failures: entry depth 128 yields 8,128 preparations against a bound of 520; bounded sparse capture yields 4 generated keys against 0. Healthy controls pass 50 entry histories and 24 Array rows. Both normal and traced selected faults pass acceptance; the final registry witnesses both. |
| A14 | Three named safeguard witnesses masked existing protections: whole-holder failure had no healthy sibling to retain, direct concat independently froze the source, and early explicit holders obscured pending direct-reaction delivery. | Supported replacements prove the guards are necessary: partial constructor reflection failure with retained unformatted poison; full/offset shared slice then concat; native/ordered pending Record/Array delivery to two direct reactions. Healthy cases pass and removing each guard fails its specific semantic assertion. Production mechanisms remain unchanged; the final registry witnesses all three. |

A07 is a support-boundary correction to the evidence, not a claim that unsupported
inputs are newly tolerated. A08 strengthens assertions. Neither category excuses
A04 or any other supported failure. No defense framework, repeated integrity
probes or public compatibility path was added.

### A04 - Finite cyclic `flat` and bounded preparation

**Confirmed defect; fixed and independently reviewed.** For `const a = []; a[0] = a`,
public `run` with `flat(2 ** 54)` previously caused stack-overflow FatalError and
closed the execution despite a finite one-element result. Number subtraction
also stops progressing at that depth. Unlimited shared empty DAGs of 5/9/13
identities required 31/511/8,191 inspections for empty output. Finite shared DAGs
and independent silent cycles exposed related repeated work.

The old recursive preparation/native flat path is removed. [FlatCapture](../src/array-flat-capture.js)
captures each physical Array's placements once, discovers available siblings
before joining pending input, and upgrades shared depth demand without cyclic
Promise joins. [Flattening](../src/array-flat.js) uses captured SCC facts and
capped nonnegative recurrence powering to decide output capacity. Ordered
materialization skips empty subgraphs and silent cycle laps; symbolic consumed
offsets preserve the original Number depth residue. Finite depth is not treated
as Infinity. Unlimited logical cycles retain InvalidArrayOperation, and impossible
finite output retains InvalidArrayLength.

Sparse powers can densify to O(n^3 log depth) arithmetic and O(n^2) storage over n
consumed identities; this is an ordinary data-graph cost, not command-history or
unfolding-depth work. Capture bounds do not imply that every algebraic count is
linear. No execution-wide scheduler, new publication path or generic cancellation
system was introduced.

Retained regressions cover sparse/mutual/emitting cycles, capacity errors,
DAG work, ArrayView identity, mixed poison and last-use release. Independent
oracles checked 5,600 cases at scaled capacity 31 and 4,259 full-capacity cases;
241 cases beyond the latter oracle's step bound were explicitly skipped, not
counted as passes. Eleven work rows, inactive-instrumentation controls and all
10 flat safeguards provide sensitivity evidence; details are in the original
verification manifest.

## Responsibility ledger

The [coverage tree](coverage-tree.md) was reconciled against actual modules,
exports, callers, tests, fixtures, package configuration and documentation.
Every current runtime implementation and test module was read completely.
The enumerated inventory below accounts for executable probes and historical or
future documents as well as current code. The new flat implementation and affected callers have independent review. Each row includes correctness and design review; executed evidence
is qualified by the verification section.

| ID / supported responsibility | Routes and enforcing modules | Correctness and design conclusion; evidence |
| --- | --- | --- |
| C01 Execution/public integration | `index`, `chain`, `execution`, `internal-step`, `data-declarations` | Required contexts, Chain binding and execution-local state traced through ready/deferred entry. Malformed root integration is an ordinary programming error; escapes from valid operations are fatal. Public exports and native-ESM/browser-loader controls cover integration. |
| C02 Progress/completion | `language-values`, `thenable-subscription`, `operation-result`, `operation-lifecycle`, `invocation` | FIFO available progress, one outward pending fatal registration, local close after required effects, shared settlement before owner check, distinct source/output/native lifetimes. Result-contract, terminal-release, fatal, continuation and work-history controls. No scheduler or cancellation layer is justified. |
| C03 Classification/reception | `meta`, `data-declarations`, `input-preparations`, `import` | First admission fixes category; fresh inspection commits atomically; prepared references preserve producer and stop traversal; failed inspection reuse is preparation-local. Declaration/receiving/preparation suites and independent preparation model. Keep admission, preparation and imported protection separate. |
| C04 Access/mutation | `path-context`, `path-operation`, `observations`, `mutations`, `mutate-property`, `language-properties` | Own enumerable placements, reached-only keys, failed-prefix scope, ordinary final replacement/delete and captured paths traced. Ready/synchronous/native/ordered key histories and placement models exercise failure/repair and sibling progress. Mutation reconstruction and optional entry discovery retain distinct duties. |
| C05 Placement/publication | `property-versions`, `placement-structure`, `parent-placements`, `array-view`, `array-length` | One forward version state supplies presence/value/order/own status; detached captures keep old producer while current destinations retire. Required storage failure differs from optional physical cache failure. Publication, storage-settlement and pending structural fixtures plus independent graph verifiers. |
| C06 Ownership/retirement | `ownership`, `parent-placements`, `captured-identity`, `array-view` | Complete cyclic incoming relationships drive liveness; counters are an optional acyclic projection. Retirement drops reverse/backing/destination state but preserves forward re-entry state. Holders, leases and writer pins have different last uses. Ownership, re-entry, GC and bounded-history checks. |
| C07 Errors/recovery | `error`, `poisoned-value`, `mutate-property`, `mutations`, `external-metadata` | Native Error data, language poison and fatal remain distinct; contextualization preserves exact causal source; failed native adoption preserves current data and repair clears own status. Error-union, attribution, failure-boundary and repair/call tests. D01 records the approved exact-status revision; D03 clarifies that owned storage writes preserve imported originals. |
| C08 Error queries/index | `observations`, `refcounts`, `external-metadata` | `hasError` may finish early; `getErrors` collects complete membership and local reflection failure. Captured metadata queries exclude later effects. Staged counter construction and incremental updates checked against parent/refcount verifiers, indexed/bare controls and historical queries. |
| C09 Expression extraction | `observations`, `poisoned-value`, `operation-result` | Supported scalar/external conversion and PoisonedValue transport preserve Error source and immediate handoff. Expression-boundary and result-contract cases cover ready/deferred rejection and invalid managed expression values. |
| C10 Entry | `enter`, `path-operation`, `external-operation`, `external-metadata` | Entry captures a reference without consuming unused suffixes; entered chains close issuance while contained native work keeps its lifetime. Mirror detach, publication, deep gates and fixed external coverage traced. Entry, entry-storage/history, metadata and conflict models. |
| C11 Calls/conversion | `run`, `invocation`, `managed-invocation`, `language-conversion`, `array-invocation` | Complete receiver capture, detached arguments, method selection, native completion, transactional adoption and independent result admission remain separate. Missing methods do not await irrelevant identity; successful native Error result is data. Invocation matrices, receiving differential and internal-fault/GC controls. |
| C12 Arrays | `array-view`, `array-length`, `array-remap`, `array-methods`, `array-flat-capture`, `array-flat` | Sparse shape, captured presence, bounds, remaps, FIFO contributions, searches, conversion and structural mutation reviewed against native/independent expectations. A04 repairs the bounded-depth/work defect and its failure family. Selected-range work must not become full-Array work. Array models, storage/length/work/retention and method suites. |
| C13 External authority | `external-access`, `external-operation`, `external-mutation-tree`, `external-metadata`, `external-snapshot` | Static finite tree and first-valid registration remain fixed. Conflicts reserve before waits; live path access rechecks retained noncanonical identities. Metadata versions need no native access for repair/query. External/key models, binding diagnostics and complete conflict partitions. |
| C14 Export/native data | `export`, `managed-capture`, `external-snapshot`, `captured-identity` | Shared capture visits each representation, drops consumed sources, collects required poison, resolves identity then assembles canonical shells. Snapshot reads remain ready-only; ordinary exports consume availability. Export/capture/snapshot, alias/cycle, capability and lifetime controls. |
| C15 Verification/project surfaces | All `test/`, executable `docs/phase5-probes`, package/lock, documentation | Discovery, bounds, independent models, non-indexing controls, executed instrumentation, selectors, process exits, timeouts and evidence provenance audited. A01/A02/A05/A06/A08-A14 repair evidence gaps, dependency integration and drift. Generated artifacts receive integration review; dependency source is not audited line by line. |

### Complete public export map

| Public exports | Reviewed responsibilities |
| --- | --- |
| `Execution`, `Chain`, `ContextChain` | C01, C02, C03, C06, C13 |
| `externalState`, `managedState`, `managedStateClass` | C03, C13 |
| `import`, `importMethodResult` | C02, C03, C06 |
| `lookupPath`, `assignPath`, `deletePath`, `repairPath` | C04-C07, C13 |
| `run` (Record/class/String/native/controlled Array; observation, mutation, repair-and-call) | C04, C07, C11-C13 |
| `enter` | C04-C06, C10, C13 |
| `hasError`, `getErrors` | C07, C08, C13 |
| `lookupPathForExpression`, `createPoisonedValue`, `isPoisonedValue` | C07, C09 |
| `export` | C02, C06, C14 |
| `PoisonError`, `CompoundPoisonError`, `FatalError`, `ERROR_KIND`, `isPoisonError`, `isFatalError`, `createPoisonError`, `validationError`, `combineErrors`, `failExecution` | C01, C07 |
| `runExternalBoundary`, `runInternalStep`, `continueOperation`, `returnOperationResult`, `isPending` | C01, C02, C03, C07 |

The controlled Array inventory includes all currently dispatched mutators,
copying/structural methods, identity searches, join/toString, flat, default sort
and toSorted, and scalar argument conversion. Callback iteration/stream modes,
persistent-layout cutovers and status-only repair remain F01-F05 future work.
Their design probes were read and their consistency reviewed; passing a design
prototype does not certify production implementation.

## Cross-cutting sweeps

| Sweep | Sites and traced transitions | Verdict and evidence |
| --- | --- | --- |
| Fact writers | Admission/category/prototype and preparation completion; forward versions; Array bounds/owners; complete parents; optional counters; identity cells; external binding/metadata/frontier; local owner/fatal pending-result registry | Creation, copying, mutation, settlement, retirement and re-entry checked at producers and consumers. Facts remain at identity, placement, path or operation scope. No unexplained second authoritative store found. Independent parent/refcount/storage verification and history counters supplement reasoning. |
| Representation authority | Logical overlays versus native descriptors; views/backings versus ranges; current destination versus detached capture; recovery baseline; observation/mutation copies; external snapshots | Required commit preflight precedes logical updates; optional cache writes cannot replace authoritative versions. Copies preserve or advance logical identity according to publication, not address. Imported host protection and detached native boundaries traced through aliases/cycles. |
| New-state consumers | Hole versus present undefined; pending presence/length/order; fixed inspection poison; retired source with live capture; copied delivery; prepared result; healthy native Error; equal identities in different representations | Path, query, Array, capture/export, invocation, ownership and indexing consumers explicitly reviewed. A04 repairs conceptual-depth work despite bounded graph size; failure/presence/identity siblings have retained regressions. |
| Equivalent routes | Chain/import/assignment/argument/native result/observation-property receiving; strict receiver adoption and ready-only snapshot distinctions; direct/entered mutation and repair; ready/synchronous/deferred keys | Shared preparation and capture are real transitions, not route-specific classifiers. Deliberate policy differences retain named boundaries. Receiving differential, directed import/path witnesses, boundary histories and external-key model compare effects as well as values. |
| Host actions | Classification prototype/constructor; ownKeys/descriptors/length; then lookup/subscription; native getters/method selection/calls; coercion; required physical writes; receiver adoption; reporters | Exact external-action guards classify supported throws/reflection failures; internal escapes remain fatal. Pure inspection grants no mutation authority. Prepared/parent/identity commit bookkeeping introduces no host reflection. Fallible native behavior has healthy controls; excluded after-admission corruption is not promised diagnostics. |

High-risk combinations included captured read then replacement/repair, failed
prerequisites before ready siblings, aliases/cycles across import and native
adoption, entry plus structural Array changes, root/intermediate late
registration during key/argument waits, historical metadata around reset,
retirement before pending settlement, and poison discard while an unrelated
required sibling remains pending. Short explicit witnesses establish expected
behavior before broader delivery differentials. A matching ready/deferred run
alone is never treated as an independent semantic oracle.

## Design review: S1-S8

| Search | Candidate invariant, deletion target and counterexample | Disposition |
| --- | --- | --- |
| S1 Capture/producer/query | Share actual capture without duplicating admission transactions; one immutable producer could replace destination adapters. A snapshot must reject unresolved data without subscribing while ordinary import installs a producer; a historical copy must outlive source overwrite. | Retain shared managed/snapshot walker and concrete readers. D04 follow-up removes recursive query completion history; the producer trials were reverted for no benefit or excessive retained work. |
| S2 Publication | One prepared placement outcome supplies storage, structure, parents and counters. An added generic commit record must remove a producer, not merely wrap existing callbacks. Required mutation failure and optional cache failure disprove one undifferentiated write path. | Existing centralized commit is worth retaining; no additional coordinator justified. |
| S3 Selection | One cursor could remove parallel key continuations, but mutation needs reconstruction, entry does not consume unused suffixes, and metadata authority differs from native access. Final selected node cannot reconstruct original static provenance. | Retain shared key consumption and explicit route duties. Earlier merged-walker experiment is evidence about that candidate only. |
| S4 Arrays | One mapping/shape engine must retain selected-range work, sparse presence and result-specific short-circuiting. Eager capture of every search or flat descendant is a counterexample. | Current flat repair removes conceptual-depth recursion for a demonstrated work defect. Persistent layouts and partial publication remain future semantics; no parallel production layout engine added. |
| S5 Forwarding | A shared representative primitive must eliminate a completion protocol while preserving identity's symmetric equality and metadata's one-way historical publication. Same-domain unresolved equality versus overwritten metadata has different wake rules. | No demonstrated simpler generic future abstraction. Retain iterative drains and source-free representatives. |
| S6 Projections/lifetimes | Derive edges from one forward placement map; eliminate redundant strong fields. Complete cyclic parents cannot replace acyclic counters without revisiting unrelated backing owners. Combining source/output/publication lifetime retains sources too long or releases baselines too early. | Keep necessary projections and separate last uses; strengthen GC witnesses instead of adding holders. |
| S7 Semantic cutovers | Status-only repair, registration-before-use and logical-only storage were considered as mechanism reductions. | D01 is implemented. D02 confirms initial tree registration already prevents post-import alias races; retain checks for late initialization. D03 confirms imported-source protection; retain writes to owned storage. |
| S8 Residual flexibility | Remove superseded paths, vacuous controls and tests for excluded misuse; share numeric settings validation among generators. Test sensitivity and independent oracles must survive consolidation. | A05-A10 and A13-A14 implemented; old flat path removed with A04. No generic policy framework added. |

## Verification and remaining queue

| Verified revision | Normal suite | Traced suite | Safeguards |
| --- | --- | --- | --- |
| Original audit, `ed1e3e1` | 6,238 | 6,238 | 269/269 witnessed |
| D04 query simplification, subsequently `d91f1bd` | 6,240 | 6,240 | 269/269 witnessed |
| D01 status repair | 6,264 | 6,264 | 272/272 witnessed |
| D02/D03 protection follow-up | 6,294 | Production unchanged from D01; no new traced run | No production guard changed |

The normal command is
`node --unhandled-rejections=strict node_modules/mocha/bin/mocha.js "test/**/*.test.js" --reporter dot`.
Tracing adds `--import=<absolute file URL of test/trace-runtime.js>` through
`NODE_OPTIONS`, including child workers. [The test guide](../test/README.md)
owns the model, probe and safeguard commands; manifests retain exact settings.

D01's final revision passes all nine generated families at 1,600 seeds, all
eight publication partitions (96,824 pairs / 290,472 deferred runs), all eight
conflict partitions (93,636 cases / 280,908 runs), all 16 retained Phase 5 probes
and the independent Array-layout probes. Enlarged runs report no failures or
skips. The publication matrix includes 63,168 independently modeled identity
pairs; other pairs use the ready/deferred oracle.

**Evidence limits:** the original audit's expanded models ran at intermediate
revisions whose vocabularies do not exercise the new flat algorithm; its final
suites and dedicated A04 checks supply that evidence. D01 retains a superseded
concurrent traced timeout; the unchanged isolated test and complete traced suite
passed with their original timeouts. Interrupted safeguard quick runs have
completed fallback witnesses. The reception fault that emitted 13 semantic
failures before exit 7 counts those witnesses, not a completed faulted suite.
Both manifests preserve these qualifications and superseded outcomes.

Coverage is bounded by model vocabularies/seeds, Node/Windows, GC turn windows
and named-witness safeguards. Browser loading uses the VM test, not a multi-browser
campaign. Dependency integration is reviewed; third-party implementation and
future F01-F05 behavior are outside current runtime coverage.

**Remaining required queue: none.** The original final diff, callers, coverage
and evidence received independent review; D01 and subsequent follow-ups are
recorded separately above. All audit decisions are resolved; D05 records the
accepted wait for upstream dependency fixes. No source review or clear repair
is unvisited or blocked.

<!-- inventory-start -->

## Enumerated file inventory

All listed files were reviewed with evidence. Implementation/test/probe review
includes complete reading; generated lock/evidence files receive integration
review. Judgments map to the responsibility ledger, with execution claims tied
to the revisions above. Historical/future documents are not current contracts.

| Follow-up addition | Responsibility / evidence |
| --- | --- |
| [docs/audit-d01-verification.json](audit-d01-verification.json) | C15 / D01 evidence integration |
| [test/query-frontier-work.test.js](../test/query-frontier-work.test.js) | C02, C08 / D04 query completion |
| [test/fixtures/query-frontier-work.mjs](../test/fixtures/query-frontier-work.mjs) | C02, C08 / D04 bounded retention and controls |
| [test/status-repair.test.js](../test/status-repair.test.js) | C04-C07, C13 / D01 status semantics |
| [test/fixtures/status-repair-work.mjs](../test/fixtures/status-repair-work.mjs) | C02, C05 / D01 pending work bounds |
| [test/fixtures/status-repair-retention.mjs](../test/fixtures/status-repair-retention.mjs) | C06, C07 / D01 diagnostic/data lifetime |
| [test/imported-storage.test.js](../test/imported-storage.test.js) | C03, C06, C11-C14 / D03 write-attempt controls |

<details>
<summary>Original audit: 350 files</summary>

| File | Responsibility |
| --- | --- |
| [.gitignore](../.gitignore) | C15 / documentation/configuration |
| [AGENTS.md](../AGENTS.md) | C15 / documentation/configuration |
| [CLAUDE.md](../CLAUDE.md) | C15 / documentation/configuration |
| [GEMINI.md](../GEMINI.md) | C15 / documentation/configuration |
| [LICENSE](../LICENSE) | C15 / documentation/configuration |
| [README.md](../README.md) | C15 / documentation/configuration |
| [array-layout-approaches.md](../array-layout-approaches.md) | C15 / documentation/configuration |
| [docs/array-iteration-technical-analysis.md](array-iteration-technical-analysis.md) | C15 / documentation/configuration |
| [docs/array-layout-implementation-findings.md](array-layout-implementation-findings.md) | C15 / documentation/configuration |
| [docs/array-method-specification.md](array-method-specification.md) | C15 / documentation/configuration |
| [docs/array-view.md](array-view.md) | C15 / documentation/configuration |
| [docs/audit-report.md](audit-report.md) | C15 / documentation/configuration |
| [docs/audit-verification.json](audit-verification.json) | C15 / generated evidence integration |
| [docs/counters-implementation.md](counters-implementation.md) | C15 / documentation/configuration |
| [docs/coverage-tree.md](coverage-tree.md) | C15 / documentation/configuration |
| [docs/cycles-as-data.md](cycles-as-data.md) | C15 / documentation/configuration |
| [docs/data-classes.md](data-classes.md) | C15 / documentation/configuration |
| [docs/data-limitations.md](data-limitations.md) | C15 / documentation/configuration |
| [docs/enter.md](enter.md) | C15 / documentation/configuration |
| [docs/error-handling.md](error-handling.md) | C15 / documentation/configuration |
| [docs/external-context-ordering.md](external-context-ordering.md) | C15 / documentation/configuration |
| [docs/feature-review-prompt.md](feature-review-prompt.md) | C15 / documentation/configuration |
| [docs/first-principles-conformance-plan.md](first-principles-conformance-plan.md) | C15 / documentation/configuration |
| [docs/import-processing.md](import-processing.md) | C15 / documentation/configuration |
| [docs/integration.md](integration.md) | C15 / documentation/configuration |
| [docs/managed-and-external-state.md](managed-and-external-state.md) | C15 / documentation/configuration |
| [docs/managed-invocation.md](managed-invocation.md) | C15 / documentation/configuration |
| [docs/mutation-and-observation.md](mutation-and-observation.md) | C15 / documentation/configuration |
| [docs/new-readme.md](new-readme.md) | C15 / documentation/configuration |
| [docs/outbound-export.md](outbound-export.md) | C15 / documentation/configuration |
| [docs/phase4-design-history.md](phase4-design-history.md) | C15 / documentation/configuration |
| [docs/phase4-review.md](phase4-review.md) | C15 / documentation/configuration |
| [docs/phase5-acceptance.json](phase5-acceptance.json) | C15 / documentation/configuration |
| [docs/phase5-probes/coordinator-probe.mjs](phase5-probes/coordinator-probe.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/copied-delivery-extra.mjs](phase5-probes/copied-delivery-extra.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/copied-delivery-recovery.mjs](phase5-probes/copied-delivery-recovery.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/deep-copy-history.mjs](phase5-probes/deep-copy-history.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/delivery-lifetime-probe.mjs](phase5-probes/delivery-lifetime-probe.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/delivery-presence.mjs](phase5-probes/delivery-presence.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/delivery-recovery.mjs](phase5-probes/delivery-recovery.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/independent-probe.mjs](phase5-probes/independent-probe.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/lifetime-overflow.mjs](phase5-probes/lifetime-overflow.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/lifetime-preparation-controls.mjs](phase5-probes/lifetime-preparation-controls.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/lifetime-remaps.mjs](phase5-probes/lifetime-remaps.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/range-selected-retention.mjs](phase5-probes/range-selected-retention.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/ready-controls.mjs](phase5-probes/ready-controls.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/sibling-lifetime-probe.mjs](phase5-probes/sibling-lifetime-probe.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/work-histories.mjs](phase5-probes/work-histories.mjs) | C15 / tests and tooling |
| [docs/phase5-probes/work-release.mjs](phase5-probes/work-release.mjs) | C15 / tests and tooling |
| [docs/phase5-review.md](phase5-review.md) | C15 / documentation/configuration |
| [docs/phase5-sensitivity.json](phase5-sensitivity.json) | C15 / documentation/configuration |
| [docs/phase5-stabilization.md](phase5-stabilization.md) | C15 / documentation/configuration |
| [docs/phase6-selection-experiments.md](phase6-selection-experiments.md) | C15 / documentation/configuration |
| [docs/promise-path-segments.md](promise-path-segments.md) | C15 / documentation/configuration |
| [docs/prompts/audit-and-fix.md](prompts/audit-and-fix.md) | C15 / documentation/configuration |
| [docs/prompts/audit.md](prompts/audit.md) | C15 / documentation/configuration |
| [docs/prompts/phase2-review-guide.md](prompts/phase2-review-guide.md) | C15 / documentation/configuration |
| [docs/prompts/phase5-rerun.md](prompts/phase5-rerun.md) | C15 / documentation/configuration |
| [docs/prompts/project-audit.md](prompts/project-audit.md) | C15 / documentation/configuration |
| [docs/remap-structure-variant-A.md](remap-structure-variant-A.md) | C15 / documentation/configuration |
| [docs/remap-structure-variant-B.md](remap-structure-variant-B.md) | C15 / documentation/configuration |
| [docs/run.md](run.md) | C15 / documentation/configuration |
| [docs/runtime-evolution-plan.md](runtime-evolution-plan.md) | C15 / documentation/configuration |
| [docs/runtime-spec.md](runtime-spec.md) | C15 / documentation/configuration |
| [docs/work-bounds.md](work-bounds.md) | C15 / documentation/configuration |
| [iterate-plan.md](../iterate-plan.md) | C15 / documentation/configuration |
| [package-lock.json](../package-lock.json) | C15 / documentation/configuration |
| [package.json](../package.json) | C15 / documentation/configuration |
| [poison-policy-plan.md](../poison-policy-plan.md) | C15 / documentation/configuration |
| [repair-simplification-plan.md](../repair-simplification-plan.md) | C15 / documentation/configuration |
| [simplifications.md](../simplifications.md) | C15 / documentation/configuration |
| [src/array-flat-capture.js](../src/array-flat-capture.js) | C02,C12 |
| [src/array-flat.js](../src/array-flat.js) | C12 |
| [src/array-invocation.js](../src/array-invocation.js) | C11,C12 |
| [src/array-length.js](../src/array-length.js) | C05,C12 |
| [src/array-methods.js](../src/array-methods.js) | C12 |
| [src/array-remap.js](../src/array-remap.js) | C12 |
| [src/array-view.js](../src/array-view.js) | C05,C06,C12 |
| [src/captured-identity.js](../src/captured-identity.js) | C06,C14 |
| [src/chain.js](../src/chain.js) | C01,C06 |
| [src/data-declarations.js](../src/data-declarations.js) | C03 |
| [src/enter.js](../src/enter.js) | C10 |
| [src/error.js](../src/error.js) | C07 |
| [src/execution.js](../src/execution.js) | C01,C02 |
| [src/export.js](../src/export.js) | C14 |
| [src/external-access.js](../src/external-access.js) | C13 |
| [src/external-metadata.js](../src/external-metadata.js) | C08,C13 |
| [src/external-mutation-tree.js](../src/external-mutation-tree.js) | C13 |
| [src/external-operation.js](../src/external-operation.js) | C13 |
| [src/external-snapshot.js](../src/external-snapshot.js) | C13,C14 |
| [src/import.js](../src/import.js) | C03 |
| [src/index.js](../src/index.js) | C01,C02 |
| [src/input-preparations.js](../src/input-preparations.js) | C03 |
| [src/internal-step.js](../src/internal-step.js) | C01,C02 |
| [src/invocation.js](../src/invocation.js) | C11 |
| [src/language-conversion.js](../src/language-conversion.js) | C11,C12 |
| [src/language-properties.js](../src/language-properties.js) | C04,C05 |
| [src/language-values.js](../src/language-values.js) | C02,C03 |
| [src/managed-capture.js](../src/managed-capture.js) | C11,C14 |
| [src/managed-invocation.js](../src/managed-invocation.js) | C11 |
| [src/meta.js](../src/meta.js) | C03,C06 |
| [src/mutate-property.js](../src/mutate-property.js) | C04,C05,C07 |
| [src/mutations.js](../src/mutations.js) | C04,C07 |
| [src/observations.js](../src/observations.js) | C04,C08,C09 |
| [src/operation-lifecycle.js](../src/operation-lifecycle.js) | C02 |
| [src/operation-result.js](../src/operation-result.js) | C02 |
| [src/ownership.js](../src/ownership.js) | C06 |
| [src/parent-placements.js](../src/parent-placements.js) | C05,C06 |
| [src/path-context.js](../src/path-context.js) | C04,C13 |
| [src/path-operation.js](../src/path-operation.js) | C04,C05,C13 |
| [src/placement-structure.js](../src/placement-structure.js) | C05 |
| [src/poisoned-value.js](../src/poisoned-value.js) | C07,C09 |
| [src/property-versions.js](../src/property-versions.js) | C05 |
| [src/refcounts.js](../src/refcounts.js) | C08 |
| [src/run.js](../src/run.js) | C11 |
| [src/thenable-subscription.js](../src/thenable-subscription.js) | C02 |
| [test/README.md](../test/README.md) | C15 / tests and tooling |
| [test/action-throw-boundaries.test.js](../test/action-throw-boundaries.test.js) | C15 / tests and tooling |
| [test/array-backing-producers.test.js](../test/array-backing-producers.test.js) | C15 / tests and tooling |
| [test/array-complete-collection.test.js](../test/array-complete-collection.test.js) | C15 / tests and tooling |
| [test/array-consumption.test.js](../test/array-consumption.test.js) | C15 / tests and tooling |
| [test/array-flat.test.js](../test/array-flat.test.js) | C15 / tests and tooling |
| [test/array-flat-work.test.js](../test/array-flat-work.test.js) | C12, C15 / work and sensitivity |
| [test/array-history-storage.test.js](../test/array-history-storage.test.js) | C15 / tests and tooling |
| [test/array-intrinsic-boundaries.test.js](../test/array-intrinsic-boundaries.test.js) | C15 / tests and tooling |
| [test/array-length.test.js](../test/array-length.test.js) | C15 / tests and tooling |
| [test/array-native-equivalence.test.js](../test/array-native-equivalence.test.js) | C15 / tests and tooling |
| [test/array-preparation.test.js](../test/array-preparation.test.js) | C15 / tests and tooling |
| [test/array-range-identity.test.js](../test/array-range-identity.test.js) | C15 / tests and tooling |
| [test/array-range-recovery.test.js](../test/array-range-recovery.test.js) | C15 / tests and tooling |
| [test/array-range-work.test.js](../test/array-range-work.test.js) | C15 / tests and tooling |
| [test/array-search-ordering.test.js](../test/array-search-ordering.test.js) | C15 / tests and tooling |
| [test/array-search.test.js](../test/array-search.test.js) | C15 / tests and tooling |
| [test/array-sort-boundaries.test.js](../test/array-sort-boundaries.test.js) | C15 / tests and tooling |
| [test/array-transition-capture.test.js](../test/array-transition-capture.test.js) | C15 / tests and tooling |
| [test/array-view-action-boundaries.test.js](../test/array-view-action-boundaries.test.js) | C15 / tests and tooling |
| [test/array-view.test.js](../test/array-view.test.js) | C15 / tests and tooling |
| [test/boundary-contracts.test.js](../test/boundary-contracts.test.js) | C15 / tests and tooling |
| [test/boundary-histories.test.js](../test/boundary-histories.test.js) | C15 / tests and tooling |
| [test/boundary-lifetimes.test.js](../test/boundary-lifetimes.test.js) | C15 / tests and tooling |
| [test/boundary-policy.test.js](../test/boundary-policy.test.js) | C15 / tests and tooling |
| [test/browser-loading.test.js](../test/browser-loading.test.js) | C15 / tests and tooling |
| [test/captured-inputs.test.js](../test/captured-inputs.test.js) | C15 / tests and tooling |
| [test/captured-shape.test.js](../test/captured-shape.test.js) | C15 / tests and tooling |
| [test/causal-failures.test.js](../test/causal-failures.test.js) | C15 / tests and tooling |
| [test/chain.test.js](../test/chain.test.js) | C15 / tests and tooling |
| [test/classification-failures.test.js](../test/classification-failures.test.js) | C15 / tests and tooling |
| [test/complete-failures.test.js](../test/complete-failures.test.js) | C15 / tests and tooling |
| [test/copied-delivery.test.js](../test/copied-delivery.test.js) | C15 / tests and tooling |
| [test/data-classes.test.js](../test/data-classes.test.js) | C15 / tests and tooling |
| [test/data-declarations.test.js](../test/data-declarations.test.js) | C15 / tests and tooling |
| [test/declaration-failure-boundaries.test.js](../test/declaration-failure-boundaries.test.js) | C15 / tests and tooling |
| [test/detached-cleanup-boundaries.test.js](../test/detached-cleanup-boundaries.test.js) | C15 / tests and tooling |
| [test/enter.test.js](../test/enter.test.js) | C15 / tests and tooling |
| [test/entry-identity-dependencies.test.js](../test/entry-identity-dependencies.test.js) | C15 / tests and tooling |
| [test/entry-identity.test.js](../test/entry-identity.test.js) | C15 / tests and tooling |
| [test/entry-storage.test.js](../test/entry-storage.test.js) | C15 / tests and tooling |
| [test/entry-structure.test.js](../test/entry-structure.test.js) | C15 / tests and tooling |
| [test/error-attribution.test.js](../test/error-attribution.test.js) | C15 / tests and tooling |
| [test/error-union.test.js](../test/error-union.test.js) | C15 / tests and tooling |
| [test/execution-context.test.js](../test/execution-context.test.js) | C15 / tests and tooling |
| [test/experiments/array-iteration-contract-probes.mjs](../test/experiments/array-iteration-contract-probes.mjs) | C15 / tests and tooling |
| [test/experiments/array-layout-technical-probes.mjs](../test/experiments/array-layout-technical-probes.mjs) | C15 / tests and tooling |
| [test/experiments/array-method-specification-probes.mjs](../test/experiments/array-method-specification-probes.mjs) | C15 / tests and tooling |
| [test/experiments/error-reporting-order.mjs](../test/experiments/error-reporting-order.mjs) | C15 / tests and tooling |
| [test/experiments/phase2-ownership-model.mjs](../test/experiments/phase2-ownership-model.mjs) | C15 / tests and tooling |
| [test/experiments/phase2-retirement.mjs](../test/experiments/phase2-retirement.mjs) | C15 / tests and tooling |
| [test/export.test.js](../test/export.test.js) | C15 / tests and tooling |
| [test/expression-boundary.test.js](../test/expression-boundary.test.js) | C15 / tests and tooling |
| [test/external-array-length-boundaries.test.js](../test/external-array-length-boundaries.test.js) | C15 / tests and tooling |
| [test/external-binding-diagnostics.test.js](../test/external-binding-diagnostics.test.js) | C15 / tests and tooling |
| [test/external-context.test.js](../test/external-context.test.js) | C15 / tests and tooling |
| [test/external-coordination.test.js](../test/external-coordination.test.js) | C15 / tests and tooling |
| [test/external-error-oracle.js](../test/external-error-oracle.js) | C15 / tests and tooling |
| [test/external-error-oracle.test.js](../test/external-error-oracle.test.js) | C15 / tests and tooling |
| [test/external-metadata.test.js](../test/external-metadata.test.js) | C15 / tests and tooling |
| [test/external-paths.test.js](../test/external-paths.test.js) | C15 / tests and tooling |
| [test/external-then-probe.test.js](../test/external-then-probe.test.js) | C15 / tests and tooling |
| [test/external-tree.test.js](../test/external-tree.test.js) | C15 / tests and tooling |
| [test/fatal-execution.test.js](../test/fatal-execution.test.js) | C15 / tests and tooling |
| [test/fixtures/argument-preparation-failure.js](../test/fixtures/argument-preparation-failure.js) | C15 / tests and tooling |
| [test/fixtures/array-enumeration-work.js](../test/fixtures/array-enumeration-work.js) | C15 / tests and tooling |
| [test/fixtures/array-failure-release.mjs](../test/fixtures/array-failure-release.mjs) | C15 / tests and tooling |
| [test/fixtures/array-point-work.js](../test/fixtures/array-point-work.js) | C15 / tests and tooling |
| [test/fixtures/array-range-failure-retention.mjs](../test/fixtures/array-range-failure-retention.mjs) | C15 / tests and tooling |
| [test/fixtures/array-range-work.js](../test/fixtures/array-range-work.js) | C15 / tests and tooling |
| [test/fixtures/array-reflection-release.mjs](../test/fixtures/array-reflection-release.mjs) | C15 / tests and tooling |
| [test/fixtures/array-remap-failure-retention.mjs](../test/fixtures/array-remap-failure-retention.mjs) | C15 / tests and tooling |
| [test/fixtures/array-sequences.js](../test/fixtures/array-sequences.js) | C15 / tests and tooling |
| [test/fixtures/array-surface.mjs](../test/fixtures/array-surface.mjs) | C15 / tests and tooling |
| [test/fixtures/array-validation-retention.mjs](../test/fixtures/array-validation-retention.mjs) | C15 / tests and tooling |
| [test/fixtures/array-view-failure-retention.mjs](../test/fixtures/array-view-failure-retention.mjs) | C15 / tests and tooling |
| [test/fixtures/boundary-histories.js](../test/fixtures/boundary-histories.js) | C15 / tests and tooling |
| [test/fixtures/boundary-release.mjs](../test/fixtures/boundary-release.mjs) | C15 / tests and tooling |
| [test/fixtures/call-selection-release.mjs](../test/fixtures/call-selection-release.mjs) | C15 / tests and tooling |
| [test/fixtures/capture-fatal.mjs](../test/fixtures/capture-fatal.mjs) | C15 / tests and tooling |
| [test/fixtures/capture-output-identity-release.mjs](../test/fixtures/capture-output-identity-release.mjs) | C15 / tests and tooling |
| [test/fixtures/classification-declaration-failure.js](../test/fixtures/classification-declaration-failure.js) | C15 / tests and tooling |
| [test/fixtures/completed-work-retention.js](../test/fixtures/completed-work-retention.js) | C15 / tests and tooling |
| [test/fixtures/conflict-matrix.js](../test/fixtures/conflict-matrix.js) | C15 / tests and tooling |
| [test/fixtures/construction-retention.js](../test/fixtures/construction-retention.js) | C15 / tests and tooling |
| [test/fixtures/continuation-failure.js](../test/fixtures/continuation-failure.js) | C15 / tests and tooling |
| [test/fixtures/deferred-validation-retention.mjs](../test/fixtures/deferred-validation-retention.mjs) | C15 / tests and tooling |
| [test/fixtures/detached-cleanup-failure.js](../test/fixtures/detached-cleanup-failure.js) | C15 / tests and tooling |
| [test/fixtures/discarded-argument-leaves.mjs](../test/fixtures/discarded-argument-leaves.mjs) | C15 / tests and tooling |
| [test/fixtures/enter-direct-import.js](../test/fixtures/enter-direct-import.js) | C15 / tests and tooling |
| [test/fixtures/entry-failure.js](../test/fixtures/entry-failure.js) | C15 / tests and tooling |
| [test/fixtures/entry-history-work.js](../test/fixtures/entry-history-work.js) | C15 / tests and tooling |
| [test/fixtures/external-owner-release.mjs](../test/fixtures/external-owner-release.mjs) | C15 / tests and tooling |
| [test/fixtures/external-sequences.js](../test/fixtures/external-sequences.js) | C15 / tests and tooling |
| [test/fixtures/finite-flat.mjs](../test/fixtures/finite-flat.mjs) | C15 / tests and tooling |
| [test/fixtures/array-flat-work.mjs](../test/fixtures/array-flat-work.mjs) | C12, C15 / work measurement |
| [test/fixtures/flat-completion.mjs](../test/fixtures/flat-completion.mjs) | C15 / tests and tooling |
| [test/fixtures/generated-runner-control.mjs](../test/fixtures/generated-runner-control.mjs) | C15 / tests and tooling |
| [test/fixtures/identity-work.js](../test/fixtures/identity-work.js) | C15 / tests and tooling |
| [test/fixtures/import-retention.js](../test/fixtures/import-retention.js) | C15 / tests and tooling |
| [test/fixtures/imported-path-lifetime.mjs](../test/fixtures/imported-path-lifetime.mjs) | C15 / tests and tooling |
| [test/fixtures/inspection-failure-retention.mjs](../test/fixtures/inspection-failure-retention.mjs) | C15 / tests and tooling |
| [test/fixtures/internal-stage-failure.js](../test/fixtures/internal-stage-failure.js) | C15 / tests and tooling |
| [test/fixtures/invocation-completion-failure.js](../test/fixtures/invocation-completion-failure.js) | C15 / tests and tooling |
| [test/fixtures/join-internal-failure.js](../test/fixtures/join-internal-failure.js) | C15 / tests and tooling |
| [test/fixtures/length-fork-work.js](../test/fixtures/length-fork-work.js) | C15 / tests and tooling |
| [test/fixtures/managed-capture-work.js](../test/fixtures/managed-capture-work.js) | C15 / tests and tooling |
| [test/fixtures/mutation-failure-retention.mjs](../test/fixtures/mutation-failure-retention.mjs) | C15 / tests and tooling |
| [test/fixtures/native-authority-work.mjs](../test/fixtures/native-authority-work.mjs) | C15 / tests and tooling |
| [test/fixtures/native-error-data.mjs](../test/fixtures/native-error-data.mjs) | C15 / tests and tooling |
| [test/fixtures/nested-sequences.js](../test/fixtures/nested-sequences.js) | C15 / tests and tooling |
| [test/fixtures/outward-completion-failure.js](../test/fixtures/outward-completion-failure.js) | C15 / tests and tooling |
| [test/fixtures/outward-registration-release.mjs](../test/fixtures/outward-registration-release.mjs) | C15 / tests and tooling |
| [test/fixtures/owner-finalization-failure.js](../test/fixtures/owner-finalization-failure.js) | C15 / tests and tooling |
| [test/fixtures/ownership-destinations.js](../test/fixtures/ownership-destinations.js) | C15 / tests and tooling |
| [test/fixtures/ownership-interactions.js](../test/fixtures/ownership-interactions.js) | C15 / tests and tooling |
| [test/fixtures/ownership-lifecycle.js](../test/fixtures/ownership-lifecycle.js) | C15 / tests and tooling |
| [test/fixtures/ownership-work.js](../test/fixtures/ownership-work.js) | C15 / tests and tooling |
| [test/fixtures/path-release.mjs](../test/fixtures/path-release.mjs) | C15 / tests and tooling |
| [test/fixtures/path-selection-work.mjs](../test/fixtures/path-selection-work.mjs) | C15 / tests and tooling |
| [test/fixtures/pending-copy-work.js](../test/fixtures/pending-copy-work.js) | C15 / tests and tooling |
| [test/fixtures/pending-push-work.js](../test/fixtures/pending-push-work.js) | C15 / tests and tooling |
| [test/fixtures/pending-structural-publication.js](../test/fixtures/pending-structural-publication.js) | C15 / tests and tooling |
| [test/fixtures/placement-capture-failure-retention.mjs](../test/fixtures/placement-capture-failure-retention.mjs) | C15 / tests and tooling |
| [test/fixtures/placement-sequences.js](../test/fixtures/placement-sequences.js) | C15 / tests and tooling |
| [test/fixtures/preparation-authority.mjs](../test/fixtures/preparation-authority.mjs) | C15 / tests and tooling |
| [test/fixtures/preparation-back-references.mjs](../test/fixtures/preparation-back-references.mjs) | C15 / tests and tooling |
| [test/fixtures/preparation-output-release.mjs](../test/fixtures/preparation-output-release.mjs) | C15 / tests and tooling |
| [test/fixtures/preparation-sequences.js](../test/fixtures/preparation-sequences.js) | C15 / tests and tooling |
| [test/fixtures/preparation-work.js](../test/fixtures/preparation-work.js) | C15 / tests and tooling |
| [test/fixtures/prepared-boundaries.mjs](../test/fixtures/prepared-boundaries.mjs) | C15 / tests and tooling |
| [test/fixtures/promise-key-differential.js](../test/fixtures/promise-key-differential.js) | C15 / tests and tooling |
| [test/fixtures/public-surface-release.mjs](../test/fixtures/public-surface-release.mjs) | C15 / tests and tooling |
| [test/fixtures/publication-model.js](../test/fixtures/publication-model.js) | C15 / tests and tooling |
| [test/fixtures/publication-pairs.js](../test/fixtures/publication-pairs.js) | C15 / tests and tooling |
| [test/fixtures/publication-rejection-audit.js](../test/fixtures/publication-rejection-audit.js) | C15 / tests and tooling |
| [test/fixtures/queue-storage-release.mjs](../test/fixtures/queue-storage-release.mjs) | C15 / tests and tooling |
| [test/fixtures/receiver-identity.mjs](../test/fixtures/receiver-identity.mjs) | C15 / tests and tooling |
| [test/fixtures/receiving-branch-poison.mjs](../test/fixtures/receiving-branch-poison.mjs) | C15 / tests and tooling |
| [test/fixtures/receiving-invocation-differential.mjs](../test/fixtures/receiving-invocation-differential.mjs) | C15 / tests and tooling |
| [test/fixtures/receiving-invocation-faults.mjs](../test/fixtures/receiving-invocation-faults.mjs) | C15 / tests and tooling |
| [test/fixtures/registration-release.mjs](../test/fixtures/registration-release.mjs) | C15 / tests and tooling |
| [test/fixtures/result-contract.mjs](../test/fixtures/result-contract.mjs) | C15 / tests and tooling |
| [test/fixtures/snapshot-identity-lifetime.js](../test/fixtures/snapshot-identity-lifetime.js) | C15 / tests and tooling |
| [test/fixtures/snapshot-internal-failure.js](../test/fixtures/snapshot-internal-failure.js) | C15 / tests and tooling |
| [test/fixtures/stable-receiving-categories.mjs](../test/fixtures/stable-receiving-categories.mjs) | C15 / tests and tooling |
| [test/fixtures/suspended-mutator-fatal.js](../test/fixtures/suspended-mutator-fatal.js) | C15 / tests and tooling |
| [test/fixtures/terminal-release.mjs](../test/fixtures/terminal-release.mjs) | C15 / tests and tooling |
| [test/generated-runner.js](../test/generated-runner.js) | C15 / tests and tooling |
| [test/generated-runner.test.js](../test/generated-runner.test.js) | C15 / tests and tooling |
| [test/generated-sequences.test.js](../test/generated-sequences.test.js) | C15 / tests and tooling |
| [test/generated-settings.js](../test/generated-settings.js) | C15 / tests and tooling |
| [test/generated-settings.test.js](../test/generated-settings.test.js) | C15 / tests and tooling |
| [test/get-errors.test.js](../test/get-errors.test.js) | C15 / tests and tooling |
| [test/graph-oracle.js](../test/graph-oracle.js) | C15 / tests and tooling |
| [test/graph-oracle.test.js](../test/graph-oracle.test.js) | C15 / tests and tooling |
| [test/has-error.test.js](../test/has-error.test.js) | C15 / tests and tooling |
| [test/identity-lineage.test.js](../test/identity-lineage.test.js) | C15 / tests and tooling |
| [test/import-progress.test.js](../test/import-progress.test.js) | C15 / tests and tooling |
| [test/import.test.js](../test/import.test.js) | C15 / tests and tooling |
| [test/imported-path-interactions.test.js](../test/imported-path-interactions.test.js) | C15 / tests and tooling |
| [test/index-recovery.test.js](../test/index-recovery.test.js) | C15 / tests and tooling |
| [test/input-preparations.test.js](../test/input-preparations.test.js) | C15 / tests and tooling |
| [test/inspection-outcomes.test.js](../test/inspection-outcomes.test.js) | C15 / tests and tooling |
| [test/internal-stage-boundaries.test.js](../test/internal-stage-boundaries.test.js) | C15 / tests and tooling |
| [test/invocation-failure-boundaries.test.js](../test/invocation-failure-boundaries.test.js) | C15 / tests and tooling |
| [test/invocation-inputs.test.js](../test/invocation-inputs.test.js) | C15 / tests and tooling |
| [test/invocation-preparation.test.js](../test/invocation-preparation.test.js) | C15 / tests and tooling |
| [test/join-failure-boundaries.test.js](../test/join-failure-boundaries.test.js) | C15 / tests and tooling |
| [test/language-values.test.js](../test/language-values.test.js) | C15 / tests and tooling |
| [test/managed-capture.test.js](../test/managed-capture.test.js) | C15 / tests and tooling |
| [test/managed-invocation.test.js](../test/managed-invocation.test.js) | C15 / tests and tooling |
| [test/managed-then-probe.test.js](../test/managed-then-probe.test.js) | C15 / tests and tooling |
| [test/meta.test.js](../test/meta.test.js) | C15 / tests and tooling |
| [test/method-result-identity.test.js](../test/method-result-identity.test.js) | C15 / tests and tooling |
| [test/module-url.js](../test/module-url.js) | C15 / tests and tooling |
| [test/native-equivalence-support.js](../test/native-equivalence-support.js) | C15 / tests and tooling |
| [test/operation-lifecycle.test.js](../test/operation-lifecycle.test.js) | C15 / tests and tooling |
| [test/operation-sequences.test.js](../test/operation-sequences.test.js) | C15 / tests and tooling |
| [test/ordered-thenable.js](../test/ordered-thenable.js) | C15 / tests and tooling |
| [test/ownership-isolation.test.js](../test/ownership-isolation.test.js) | C15 / tests and tooling |
| [test/ownership.test.js](../test/ownership.test.js) | C15 / tests and tooling |
| [test/parent-placements.test.js](../test/parent-placements.test.js) | C15 / tests and tooling |
| [test/path-operations.test.js](../test/path-operations.test.js) | C15 / tests and tooling |
| [test/pending-boundary-histories.test.js](../test/pending-boundary-histories.test.js) | C15 / tests and tooling |
| [test/pending-copy-work.test.js](../test/pending-copy-work.test.js) | C15 / tests and tooling |
| [test/pending-push-work.test.js](../test/pending-push-work.test.js) | C15 / tests and tooling |
| [test/phase5-boundary-intersections.test.js](../test/phase5-boundary-intersections.test.js) | C15 / tests and tooling |
| [test/phase5-execution-interactions.test.js](../test/phase5-execution-interactions.test.js) | C15 / tests and tooling |
| [test/phase5-surface-intersections.test.js](../test/phase5-surface-intersections.test.js) | C15 / tests and tooling |
| [test/placement-version-boundaries.test.js](../test/placement-version-boundaries.test.js) | C15 / tests and tooling |
| [test/poison-reception-attribution.test.js](../test/poison-reception-attribution.test.js) | C15 / tests and tooling |
| [test/prepared-input-failure-boundaries.test.js](../test/prepared-input-failure-boundaries.test.js) | C15 / tests and tooling |
| [test/presence-summaries.test.js](../test/presence-summaries.test.js) | C15 / tests and tooling |
| [test/promise-path-segments.test.js](../test/promise-path-segments.test.js) | C15 / tests and tooling |
| [test/promises.test.js](../test/promises.test.js) | C15 / tests and tooling |
| [test/public-exports.test.js](../test/public-exports.test.js) | C15 / tests and tooling |
| [test/publication-failure-boundaries.test.js](../test/publication-failure-boundaries.test.js) | C15 / tests and tooling |
| [test/publication-failures.test.js](../test/publication-failures.test.js) | C15 / tests and tooling |
| [test/publication-trace.test.js](../test/publication-trace.test.js) | C15 / tests and tooling |
| [test/query-failures.test.js](../test/query-failures.test.js) | C15 / tests and tooling |
| [test/receiving-contracts.test.js](../test/receiving-contracts.test.js) | C15 / tests and tooling |
| [test/receiving-invocation-differential.test.js](../test/receiving-invocation-differential.test.js) | C15 / tests and tooling |
| [test/receiving-order.test.js](../test/receiving-order.test.js) | C15 / tests and tooling |
| [test/receiving-paths.test.js](../test/receiving-paths.test.js) | C15 / tests and tooling |
| [test/refcounts.test.js](../test/refcounts.test.js) | C15 / tests and tooling |
| [test/reflection-boundaries.test.js](../test/reflection-boundaries.test.js) | C15 / tests and tooling |
| [test/repair-call-recovery.test.js](../test/repair-call-recovery.test.js) | C15 / tests and tooling |
| [test/representation-identity.test.js](../test/representation-identity.test.js) | C15 / tests and tooling |
| [test/run.test.js](../test/run.test.js) | C15 / tests and tooling |
| [test/runtime-boundaries.test.js](../test/runtime-boundaries.test.js) | C15 / tests and tooling |
| [test/runtime-loaders.test.js](../test/runtime-loaders.test.js) | C15 / tests and tooling |
| [test/runtime-transform.js](../test/runtime-transform.js) | C15 / tests and tooling |
| [test/safeguard-evidence.test.js](../test/safeguard-evidence.test.js) | C15 / tests and tooling |
| [test/safeguards/evidence.mjs](../test/safeguards/evidence.mjs) | C15 / tests and tooling |
| [test/safeguards/fault-hook.mjs](../test/safeguards/fault-hook.mjs) | C15 / tests and tooling |
| [test/safeguards/registry.mjs](../test/safeguards/registry.mjs) | C15 / tests and tooling |
| [test/safeguards/run.mjs](../test/safeguards/run.mjs) | C15 / tests and tooling |
| [test/scope-recovery.test.js](../test/scope-recovery.test.js) | C15 / tests and tooling |
| [test/snapshot-failure-boundaries.test.js](../test/snapshot-failure-boundaries.test.js) | C15 / tests and tooling |
| [test/snapshot-identity.test.js](../test/snapshot-identity.test.js) | C15 / tests and tooling |
| [test/storage-settlement.test.js](../test/storage-settlement.test.js) | C15 / tests and tooling |
| [test/stress.test.js](../test/stress.test.js) | C15 / tests and tooling |
| [test/string-native-equivalence.test.js](../test/string-native-equivalence.test.js) | C15 / tests and tooling |
| [test/support.js](../test/support.js) | C15 / tests and tooling |
| [test/supported-thenables.test.js](../test/supported-thenables.test.js) | C15 / tests and tooling |
| [test/then-probe-boundaries.test.js](../test/then-probe-boundaries.test.js) | C15 / tests and tooling |
| [test/trace-runtime.js](../test/trace-runtime.js) | C15 / tests and tooling |
| [test/trace-state.js](../test/trace-state.js) | C15 / tests and tooling |
| [test/verify-parents.js](../test/verify-parents.js) | C15 / tests and tooling |
| [test/verify-refcounts.js](../test/verify-refcounts.js) | C15 / tests and tooling |
| [test/verify-storage.js](../test/verify-storage.js) | C15 / tests and tooling |
| [test/verify-storage.test.js](../test/verify-storage.test.js) | C15 / tests and tooling |
| [test/write-based-identity.test.js](../test/write-based-identity.test.js) | C15 / tests and tooling |

</details>
