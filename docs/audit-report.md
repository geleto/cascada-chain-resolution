# Whole-project audit and repair - 2026-11-06

## Unresolved findings and decisions

**Complete at `ed1e3e1`.** The whole-project sweep, authorized repairs and final independent
review are finished. All 350 files and current supported operations are
reconciled below. Final normal and traced suites each pass 6,238 tests, all 16
reusable probes pass, and all 269 safeguards have named semantic witnesses.
D05 records the remaining development dependency risk; D01-D03 are semantic
choices. D04 records the subsequent query simplification and the remaining
producer hypothesis. The original audit inventory and verification manifest
below describe `ed1e3e1`; D04 follow-up evidence is separate. No semantic
architecture change was made.

### D05 - Development glob advisories require an upstream migration decision

**Dependency risk; no supported runtime exploit established.** After compatible
lockfile updates, `npm audit` still reports three moderate package entries
(`glob`, its `minimatch` dependency, and affected parent `mocha`) for two upstream
issues. Glob's cancellation fix is in 14.0.2 or later; minimatch's amplification
fix is in 11.0.1 or later. See the primary [glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
and [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

These are development-only dependencies. The package declares no production
dependencies; Mocha's inspected file discovery uses synchronous globbing without
AbortSignal, and repository commands supply fixed trusted patterns. This limits
current exposure; it does not make the upstream packages patched. Compatible
updates cannot reach the fixed major versions. Even the [Mocha 12.0.3 manifest](https://github.com/mochajs/mocha/blob/v12.0.3/package.json)
still requests glob 13 and minimatch 10. npm's proposed force action downgrades the
pinned Mocha to 11.0.0; that is not a compatible patch update.

Recommended next step: adopt an upstream Mocha release using patched ranges, or
explicitly maintain and validate scoped major-version overrides for its glob
integration. The tradeoff is maintaining dependencies outside the runner's
supported ranges rather than relying on its upstream integration. This audit
keeps the existing runner pin and reports the remaining audit failure. Compatible
brace-expansion, js-yaml and serialize-javascript updates are implemented under
A12; installation, dependency integration and both final full suites pass.

### D01 - Status-only repair is a future semantic cutover

**Design decision; no current defect.** Current repair restores the selected
recovery baseline; F04 selects clearing status on current data instead. This
would remove repair-only predecessors, preservation links and restoration
walks, but changes results after failed mutations. Retain current repair until
the explicit migration described in [repair plan](../repair-simplification-plan.md).
Next step: approve and implement that cutover with before/after data, external
metadata, historical-query and entry examples. No repair semantics changed here.

### D02 - Registration before first use would narrow host support

**Design alternative; needs a contract decision.** Requiring registration before
any crossing could remove retained noncanonical identity sets and post-wait
revision checks. Current late first registration is supported and must reject
continued native access through retained roots and intermediates as well as the
receiver. Keep those checks. Next step, if this alternative is wanted: specify
host migration and the lost late-registration behavior before prototyping.
See [S7 decisions](../simplifications.md).

### D03 - Logical-only managed storage changes failure observability

**Design alternative; needs a contract decision.** Removing physical managed
writeback might remove storage/overlay reconciliation, but also removes supported
Proxy/descriptor write failures and changes repair outcomes. It is not an
implementation-only cleanup. Next step: define the exact host-storage and
failure contract, then compare ordinary writes, optional delivery cache writes,
failed preflight and recovery against it. No such cutover was made.

### D04 - Query completion simplified; producer redesign remains unproven

**Query experiment retained; no contract change.** The follow-up starts from
clean commit `ed1e3e1f9b91976ec62f75879f3edd07a28a445f`. In
[`observations.js`](../src/observations.js), one operation-local pending-part
counter replaces recursive wait arrays, their `Promise.all` hierarchy and the
separate external-metadata readiness field. Discovery registers descendants
before completing its part; the initial discovery part prevents premature
completion during synchronous traversal. Each actual pending transition uses
the existing guarded continuation. Indexed pruning, captured property versions,
early `hasError` success, complete `getErrors` collection and failure handling
retain their existing paths. No producer or publication mechanism changes.

**Executed comparison:** a public query follows successively delivered
`{ next: pending }` nodes, with only the final dependency unresolved. The source
Chain and result remain live across GC. Under Node `v24.14.1`, retained Promise
counts for `hasError` were:

| Delivered stages | Original | Simplified |
| --- | --- | --- |
| 16 | 82 | 18 |
| 64 | 273 | 17 |
| 128 | 529 | 17 |

`getErrors` retains 17 at all three sizes with the simplified implementation.
The [retained regression](../test/query-frontier-work.test.js) and its
[GC fixture](../test/fixtures/query-frontier-work.mjs) check bounded growth with
collection tolerance, not these exact counts. Substituting the
original observations module fails that bound; disabling the Promise tracker
fails its independent control. Healthy checks require pending descendants to
delay the result, then verify the final query and exported source. This removes
spent completion history while required work remains pending.

There is an allocation tradeoff: a separate 64-leaf wide query creates 329
Promises versus 268 before. A 64-stage query with pending side branches creates
1,155 versus 1,156 and eliminates 64 query aggregates. These are allocation
counts, not elapsed-time benchmarks. Retain the smaller completion protocol and
bounded retention; do not claim a universal speed or allocation improvement.

**Executed verification:** the full Mocha suite passes **6,240 tests** normally
and **6,240 with publication tracing**, under strict unhandled rejections.
Tracing is propagated to child workers through `NODE_OPTIONS`; 364 loader
instances and 241 execution receipts match the original audit's per-script
counts plus the two new fixture executions. The complete safeguard registry
passes **269/269**, with 1,075 semantic failures and no fallback runs. The known
faulted reception worker still emits its 13 witnesses before exiting 7, as
qualified in the original audit below. Full-suite coverage includes copied
delivery/re-entry, bounded pending copy/push, short-circuit and failure-discard
checks. The focused traced query/lifetime run also passed 281 tests.

The full command is `node --unhandled-rejections=strict
node_modules/mocha/bin/mocha.js "test/**/*.test.js" --reporter dot`; the traced
run adds `--import=<absolute file URL of test/trace-runtime.js>` to
`NODE_OPTIONS`. Safeguards use `node test/safeguards/run.mjs --skip-baseline
--parallel=3 --report=<temporary report path>` after the healthy full run.
Source and test code remained unchanged throughout final verification;
`observations.js` SHA-256 is
`d778bf42f28479c7510bacd266e2985d08ab7354d1a53ea090c7da4b27b81276`.
The original audit's `audit-verification.json` remains unchanged; its expanded
model and probe results are historical, not fresh follow-up runs. Working logs,
input hashes and before/after probes are in `%TEMP%/cascada-d04-ed1e3e1/`.

**Remaining producer hypothesis:** copied delivery already captures one
completion independently of later source writes. A broader immutable-producer
design must also replace gate and mutation-version authority; direct source
sharing loses historical delivery after overwrite/retirement. No smaller
replacement was demonstrated, so that machinery is retained. A generic eager
capture engine still consumes unused search/flat data. S1/S4 remain search
areas; future producer work must remove an actual protocol and pass copied
delivery, source re-entry, bounded pending-copy/push, short-circuit and
failure-discard witnesses.

## Baseline and evidence policy

- Baseline commit: `b4de642b672e4c1e10ca4589bb8d0b26344160ba`; initial staged,
  unstaged and untracked changes: none.
- Environment: Windows, PowerShell, Node `v24.14.1`, npm `11.11.0`, Mocha `11.3.0`.
- Baseline: `npm test -- --reporter dot` - **6,189 passing (3m)**.
- Working evidence: `%TEMP%/cascada-audit-2026-11-06/`. The linked [verification record](audit-verification.json) retains
  self-contained outcomes and source fingerprints; temporary log paths alone
  are not pass evidence. No commits, staging or publication were performed.
- Evidence is labeled **reasoned**, **executed**, or **untested**. Full reading
  does not mean every possible execution has been tested. States are
  **unvisited**, **in progress**, **reviewed with evidence**, and **blocked**.
- Production ownership was partitioned. Intermediate focused runs apply to
  their recorded patch; final normal/traced checks cover the frozen production revision. Long models that do not invoke flat may
  retain their earlier results with that explicit dependency qualification.
- Historical Phase 5 JSON files were checked for schema, candidate manifests,
  commands, references and evidence qualifications. Their October outcomes are
  historical, not newly executed acceptance of this candidate. They are not
  silently repinned.

## Fixed findings

| ID | Finding, correction and causal evidence | Validation |
| --- | --- | --- |
| A01 | Safeguard `--parallel=0`, malformed, negative or fractional values could run no jobs and exit successfully. Require a positive safe integer; allocate at most the selected job count. | Six invalid-worker controls pass; the original five fail before/pass after, and the sixth rejects a trailing malformed value. A real safeguard with `9007199254740991` workers requested executes both intended witnesses without excessive allocation. |
| A02 | A reporter `end` with zero failures masked unsuccessful baseline process exit. Require completed reporting, zero failures, exit 0 and no signal. | A retained actual-child loader emits `end` then exits 1; repaired runner exits 2 before any fault experiment. |
| A03 | Manifest and lockfile root declared ISC while LICENSE is BSD 2-Clause. Correct both to BSD-2-Clause. | Root metadata and dependency integration inspected; final package check recorded below. |
| A04 | Finite cyclic flat overflowed the stack or lost depth residue; shared empty DAGs repeated preparation exponentially. Replace per-depth recursive remaps/native flat with one capture per physical Array and bounded graph/output processing. | 312 bounded finite cases; 179 focused tests; 30 flat completion/GC cases; 11 work rows and inactive-instrumentation controls; independent capacity oracle 5,600 cases. Details below. |
| A05 | Generated numeric settings and shards could select zero cases or accept malformed values; matrix mode typos silently selected another mode. One shared validator now rejects invalid/empty coverage selections, including direct receiving-differential invocation and safe derived program indexes. | Retained subprocess controls exercise actual CLI paths, range/shard bounds, seed minimums and continuation/deadline settings. Expanded runs use valid non-empty settings; their earlier source provenance is qualified below. |
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

Retained regressions cover huge finite sparse/mutual/emitting/branching cycles,
near-capacity and nested output overflow, DAGs, depth-zero presence, ArrayView
identity, later depth upgrades, mixed cycle/reflection poison and source/payload
release while required siblings remain pending. Independent review rejected and
replaced intermediate memo-key, cyclic-join and failure-retention candidates.
The final bounded fixture checks 312 cases; an independent naive oracle checks
5,600 cases at scaled capacity 31 with no skips. A separate full-capacity oracle
passes 4,259 cases and explicitly skips 241 over its output-step bound; those
skips are not pass evidence. Eleven retained work rows and disabled-loader/
inactive-counter controls verify measurement sensitivity. All 10 current flat
safeguards have observed semantic witnesses; superseded path safeguards were
removed, and source-release coverage moved to the surviving cleanup boundary.

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
| C05 Placement/publication | `property-versions`, `placement-structure`, `parent-placements`, `array-view`, `array-length` | One forward version state supplies presence/value/order/recovery; detached captures keep old producer while current destinations retire. Required storage failure differs from optional physical cache failure. Publication, storage-settlement and pending structural fixtures plus independent graph verifiers. |
| C06 Ownership/retirement | `ownership`, `parent-placements`, `captured-identity`, `array-view` | Complete cyclic incoming relationships drive liveness; counters are an optional acyclic projection. Retirement drops reverse/backing/destination state but preserves forward re-entry state. Holders, leases and writer pins have different last uses. Ownership, re-entry, GC and bounded-history checks. |
| C07 Errors/recovery | `error`, `poisoned-value`, `mutate-property`, `mutations`, `external-metadata` | Native Error data, language poison and fatal remain distinct; contextualization preserves exact causal source; recovery retains supported baseline. Error-union, attribution, failure-boundary and repair/call tests. D01/D03 isolate semantic alternatives. |
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
| S1 Capture/producer/query | Share actual capture without duplicating admission transactions; one immutable producer could replace destination adapters. A snapshot must reject unresolved data without subscribing while ordinary import installs a producer; a historical copy must outlive source overwrite. | Retain shared managed/snapshot walker and concrete readers. D04 follow-up removes recursive query completion history; the producer alternative remains unproven. |
| S2 Publication | One prepared placement outcome supplies storage, structure, parents and counters. An added generic commit record must remove a producer, not merely wrap existing callbacks. Required mutation failure and optional cache failure disprove one undifferentiated write path. | Existing centralized commit is worth retaining; no additional coordinator justified. |
| S3 Selection | One cursor could remove parallel key continuations, but mutation needs reconstruction, entry does not consume unused suffixes, and metadata authority differs from native access. Final selected node cannot reconstruct original static provenance. | Retain shared key consumption and explicit route duties. Earlier merged-walker experiment is evidence about that candidate only. |
| S4 Arrays | One mapping/shape engine must retain selected-range work, sparse presence and result-specific short-circuiting. Eager capture of every search or flat descendant is a counterexample. | Current flat repair removes conceptual-depth recursion for a demonstrated work defect. Persistent layouts and partial publication remain future semantics; no parallel production layout engine added. |
| S5 Forwarding | A shared representative primitive must eliminate a completion protocol while preserving identity's symmetric equality and metadata's one-way historical publication. Same-domain unresolved equality versus overwritten metadata has different wake rules. | No demonstrated simpler generic future abstraction. Retain iterative drains and source-free representatives. |
| S6 Projections/lifetimes | Derive edges from one forward placement map; eliminate redundant strong fields. Complete cyclic parents cannot replace acyclic counters without revisiting unrelated backing owners. Combining source/output/publication lifetime retains sources too long or releases baselines too early. | Keep necessary projections and separate last uses; strengthen GC witnesses instead of adding holders. |
| S7 Semantic cutovers | Status-only repair, registration-before-use and logical-only storage could delete mechanisms but change supported results/failures. | D01-D03 require explicit decisions; not implemented as audit repairs. |
| S8 Residual flexibility | Remove superseded paths, vacuous controls and tests for excluded misuse; share numeric settings validation among generators. Test sensitivity and independent oracles must survive consolidation. | A05-A10 and A13-A14 implemented; old flat path removed with A04. No generic policy framework added. |

## Verification and remaining queue

**Executed intermediate evidence:** baseline 6,189 passes; root evidence/tooling
46 passes; declarations/context/browser and boundary suites; 491 causal/fatal/
thenable/attribution cases; 32 boundary-release, 50 public-surface-release and 10
capture-fatal cases; result contract 384 policy, 80 finalization and 7 additional
cases; strengthened receiving-order and ownership/lifetime fixtures; generated
settings/selector/counter controls; corrected 36-history coordinator and
144-history work probe. Subsystem focused runs are not summed because they
overlap. Final suite outcomes below supersede these integration counts.

**Expanded model evidence already executed at 1,600 seeds:** preparation 12,928
reception programs plus 1,600 lifecycle programs (43,584 runs total), placement
6,400 cases, nested 9,600 programs/28,800 runs, external 9,600/28,800, Promise-key
9,602/28,806, active boundary 51,200 histories plus 128 retired-root programs,
and 12,800 genuinely pending repeated-root histories. All reported zero failures
and skips. The Array run also passed 9,600 programs/28,800 runs. All eight publication
partitions passed 96,824 pairs/290,472 deferred runs; 63,168 pairs have the
additional independent identity model (10,490 modeled failures). The remaining
pairs use a ready/deferred oracle. All eight conflict partitions also passed 93,636 cases/280,908 runs in all
three harness modes. The separately required receiving/invocation differential passed 1,600
programs, 152,000 original and 153,600 joint histories, with zero failures/skips
and all four named controls. These models do not invoke the new flat
algorithm except where explicitly noted in final validation; unchanged model
coverage is not claimed as flat regression evidence.

**Final frozen checks:** 299 execution inputs have digest
`e13a13c39008865c1bfe373ed058d6d0577f6db2a37337f47c3b360e5afba5a3`.
The [verification record](audit-verification.json) contains every input hash,
commands, settings, outcomes and log hashes. No execution input changed during
these checks. Normal and traced full suites each pass **6,238 tests**, in
203.458 and 222.126 seconds respectively. All 16 retained Phase 5 probes pass
under strict rejections, exposed GC and stack limit 1,000. Current probes test
present behavior; historical JSON outcomes retain their original revisions.

Expanded checks above were executed during this audit. Most loaded the baseline
runtime with audit tooling corrections; later partitions and receiving checks
loaded intermediate flat code. Their vocabularies do not invoke flat, so their
results remain valid for unchanged reachable behavior. They are not evidence
for the new algorithm. The final suites and dedicated A04 regressions validate
the changed production path. Exact command and source qualifications accompany
the expanded results in the verification record.

The complete safeguard registry passes **269/269** in 194.9 seconds on the same
unchanged input digest, using named witnesses throughout (no fallback was
needed). Its 1,075 emitted failures were reviewed as semantic sensitivity, with
fault receipts. The `property-reception-prepares-managed-state` faulted child
emitted 13 admission/value failures and then exited 7 before reporter completion;
its observed witnesses count, but its faulted suite is not described as complete.
Other deliberate faults expose bounded completion/resource failures or internal
invariant errors; they are distinguished from startup or instrumentation failure.
A13's rejected partial run is preserved only as superseded evidence.

The traced suite records 362 loader instances and 239 actual runtime-wrapper
execution hits. The 123 load-only instances reconcile to intentional validation,
instrumentation and baseline controls or generated coordinators; ordinary runtime
fixtures all have execution witnesses. There are no unmatched or duplicate
execution events.

**Remaining queue: none.** Two independent reviewers approved the final diff,
affected callers, report, generated evidence integration and coverage ledger.
Only D01-D05 remain as the explicitly described decisions/risks above.
All 350 files, 35 public exports, C01-C15 responsibilities, S1-S8 searches and five
cross-cutting sweeps are reconciled. No source review or clear repair is unvisited
or blocked. Package dry-run, dependency integration, whitespace and 1,850 local
link/anchor checks pass; D05 accurately retains the full dependency audit's
nonzero result.

Verification is bounded: finite model vocabularies and seeds, Node/Windows host,
GC turn windows with retained healthy controls, and named-witness safeguard mode
rather than full-suite-per-fault. Browser loading uses the repository's VM test,
not an interactive multi-browser compatibility campaign. Third-party dependency
implementation is outside first-party audit scope; package integration is in
scope. Future F01-F05 support is not implemented or counted as current coverage.

<!-- inventory-start -->

## Enumerated file inventory

Each implementation/test/probe is fully read unless explicitly marked in
progress. Correctness/design judgments map to the responsibility ledger above;
executed evidence has its own revision and bounds. Generated lock/evidence files
receive integration review. Dated design history is distinct from current
requirements. The report and verification record passed final independent review.

| File | Responsibility | State | Reviewer |
| --- | --- | --- | --- |
| [.gitignore](../.gitignore) | C15 / documentation/configuration | Reviewed with evidence | root |
| [AGENTS.md](../AGENTS.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [CLAUDE.md](../CLAUDE.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [GEMINI.md](../GEMINI.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [LICENSE](../LICENSE) | C15 / documentation/configuration | Reviewed with evidence | root |
| [README.md](../README.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [array-layout-approaches.md](../array-layout-approaches.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [docs/array-iteration-technical-analysis.md](array-iteration-technical-analysis.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [docs/array-layout-implementation-findings.md](array-layout-implementation-findings.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [docs/array-method-specification.md](array-method-specification.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [docs/array-view.md](array-view.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [docs/audit-report.md](audit-report.md) | C15 / documentation/configuration | Reviewed with evidence | root, graph |
| [docs/audit-verification.json](audit-verification.json) | C15 / generated evidence integration | Reviewed with evidence | root, graph, external |
| [docs/counters-implementation.md](counters-implementation.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/coverage-tree.md](coverage-tree.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/cycles-as-data.md](cycles-as-data.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/data-classes.md](data-classes.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/data-limitations.md](data-limitations.md) | C15 / documentation/configuration | Reviewed with evidence | root, graph |
| [docs/enter.md](enter.md) | C15 / documentation/configuration | Reviewed with evidence | external |
| [docs/error-handling.md](error-handling.md) | C15 / documentation/configuration | Reviewed with evidence | external |
| [docs/external-context-ordering.md](external-context-ordering.md) | C15 / documentation/configuration | Reviewed with evidence | external |
| [docs/feature-review-prompt.md](feature-review-prompt.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/first-principles-conformance-plan.md](first-principles-conformance-plan.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/import-processing.md](import-processing.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/integration.md](integration.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/managed-and-external-state.md](managed-and-external-state.md) | C15 / documentation/configuration | Reviewed with evidence | graph, external |
| [docs/managed-invocation.md](managed-invocation.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/mutation-and-observation.md](mutation-and-observation.md) | C15 / documentation/configuration | Reviewed with evidence | graph, external |
| [docs/new-readme.md](new-readme.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/outbound-export.md](outbound-export.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/phase4-design-history.md](phase4-design-history.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/phase4-review.md](phase4-review.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/phase5-acceptance.json](phase5-acceptance.json) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/phase5-probes/coordinator-probe.mjs](phase5-probes/coordinator-probe.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/copied-delivery-extra.mjs](phase5-probes/copied-delivery-extra.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/copied-delivery-recovery.mjs](phase5-probes/copied-delivery-recovery.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/deep-copy-history.mjs](phase5-probes/deep-copy-history.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/delivery-lifetime-probe.mjs](phase5-probes/delivery-lifetime-probe.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/delivery-presence.mjs](phase5-probes/delivery-presence.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/delivery-recovery.mjs](phase5-probes/delivery-recovery.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/independent-probe.mjs](phase5-probes/independent-probe.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/lifetime-overflow.mjs](phase5-probes/lifetime-overflow.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/lifetime-preparation-controls.mjs](phase5-probes/lifetime-preparation-controls.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/lifetime-remaps.mjs](phase5-probes/lifetime-remaps.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/range-selected-retention.mjs](phase5-probes/range-selected-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/ready-controls.mjs](phase5-probes/ready-controls.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/sibling-lifetime-probe.mjs](phase5-probes/sibling-lifetime-probe.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/work-histories.mjs](phase5-probes/work-histories.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-probes/work-release.mjs](phase5-probes/work-release.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [docs/phase5-review.md](phase5-review.md) | C15 / documentation/configuration | Reviewed with evidence | root + graph (complete split read) |
| [docs/phase5-sensitivity.json](phase5-sensitivity.json) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/phase5-stabilization.md](phase5-stabilization.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/phase6-selection-experiments.md](phase6-selection-experiments.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/promise-path-segments.md](promise-path-segments.md) | C15 / documentation/configuration | Reviewed with evidence | external |
| [docs/prompts/audit-and-fix.md](prompts/audit-and-fix.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/prompts/audit.md](prompts/audit.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/prompts/phase2-review-guide.md](prompts/phase2-review-guide.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/prompts/phase5-rerun.md](prompts/phase5-rerun.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/prompts/project-audit.md](prompts/project-audit.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/remap-structure-variant-A.md](remap-structure-variant-A.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [docs/remap-structure-variant-B.md](remap-structure-variant-B.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [docs/run.md](run.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [docs/runtime-evolution-plan.md](runtime-evolution-plan.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [docs/runtime-spec.md](runtime-spec.md) | C15 / documentation/configuration | Reviewed with evidence | root |
| [docs/work-bounds.md](work-bounds.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [iterate-plan.md](../iterate-plan.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [package-lock.json](../package-lock.json) | C15 / documentation/configuration | Reviewed with evidence | root |
| [package.json](../package.json) | C15 / documentation/configuration | Reviewed with evidence | root |
| [poison-policy-plan.md](../poison-policy-plan.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [repair-simplification-plan.md](../repair-simplification-plan.md) | C15 / documentation/configuration | Reviewed with evidence | arrays |
| [simplifications.md](../simplifications.md) | C15 / documentation/configuration | Reviewed with evidence | graph |
| [src/array-flat-capture.js](../src/array-flat-capture.js) | C02,C12 | Reviewed with evidence | arrays, graph, root |
| [src/array-flat.js](../src/array-flat.js) | C12 | Reviewed with evidence | root, graph |
| [src/array-invocation.js](../src/array-invocation.js) | C11,C12 | Reviewed with evidence | arrays |
| [src/array-length.js](../src/array-length.js) | C05,C12 | Reviewed with evidence | arrays |
| [src/array-methods.js](../src/array-methods.js) | C12 | Reviewed with evidence | arrays |
| [src/array-remap.js](../src/array-remap.js) | C12 | Reviewed with evidence | arrays |
| [src/array-view.js](../src/array-view.js) | C05,C06,C12 | Reviewed with evidence | arrays |
| [src/captured-identity.js](../src/captured-identity.js) | C06,C14 | Reviewed with evidence | graph |
| [src/chain.js](../src/chain.js) | C01,C06 | Reviewed with evidence | root |
| [src/data-declarations.js](../src/data-declarations.js) | C03 | Reviewed with evidence | root |
| [src/enter.js](../src/enter.js) | C10 | Reviewed with evidence | external |
| [src/error.js](../src/error.js) | C07 | Reviewed with evidence | root |
| [src/execution.js](../src/execution.js) | C01,C02 | Reviewed with evidence | root |
| [src/export.js](../src/export.js) | C14 | Reviewed with evidence | graph |
| [src/external-access.js](../src/external-access.js) | C13 | Reviewed with evidence | external |
| [src/external-metadata.js](../src/external-metadata.js) | C08,C13 | Reviewed with evidence | external |
| [src/external-mutation-tree.js](../src/external-mutation-tree.js) | C13 | Reviewed with evidence | external |
| [src/external-operation.js](../src/external-operation.js) | C13 | Reviewed with evidence | external |
| [src/external-snapshot.js](../src/external-snapshot.js) | C13,C14 | Reviewed with evidence | external |
| [src/import.js](../src/import.js) | C03 | Reviewed with evidence | graph |
| [src/index.js](../src/index.js) | C01,C02 | Reviewed with evidence | root |
| [src/input-preparations.js](../src/input-preparations.js) | C03 | Reviewed with evidence | graph |
| [src/internal-step.js](../src/internal-step.js) | C01,C02 | Reviewed with evidence | root |
| [src/invocation.js](../src/invocation.js) | C11 | Reviewed with evidence | graph |
| [src/language-conversion.js](../src/language-conversion.js) | C11,C12 | Reviewed with evidence | arrays |
| [src/language-properties.js](../src/language-properties.js) | C04,C05 | Reviewed with evidence | arrays |
| [src/language-values.js](../src/language-values.js) | C02,C03 | Reviewed with evidence | arrays |
| [src/managed-capture.js](../src/managed-capture.js) | C11,C14 | Reviewed with evidence | graph |
| [src/managed-invocation.js](../src/managed-invocation.js) | C11 | Reviewed with evidence | graph |
| [src/meta.js](../src/meta.js) | C03,C06 | Reviewed with evidence | graph |
| [src/mutate-property.js](../src/mutate-property.js) | C04,C05,C07 | Reviewed with evidence | external |
| [src/mutations.js](../src/mutations.js) | C04,C07 | Reviewed with evidence | external |
| [src/observations.js](../src/observations.js) | C04,C08,C09 | Reviewed with evidence | external |
| [src/operation-lifecycle.js](../src/operation-lifecycle.js) | C02 | Reviewed with evidence | root |
| [src/operation-result.js](../src/operation-result.js) | C02 | Reviewed with evidence | root |
| [src/ownership.js](../src/ownership.js) | C06 | Reviewed with evidence | graph |
| [src/parent-placements.js](../src/parent-placements.js) | C05,C06 | Reviewed with evidence | graph |
| [src/path-context.js](../src/path-context.js) | C04,C13 | Reviewed with evidence | external |
| [src/path-operation.js](../src/path-operation.js) | C04,C05,C13 | Reviewed with evidence | external |
| [src/placement-structure.js](../src/placement-structure.js) | C05 | Reviewed with evidence | graph |
| [src/poisoned-value.js](../src/poisoned-value.js) | C07,C09 | Reviewed with evidence | root |
| [src/property-versions.js](../src/property-versions.js) | C05 | Reviewed with evidence | graph |
| [src/refcounts.js](../src/refcounts.js) | C08 | Reviewed with evidence | graph |
| [src/run.js](../src/run.js) | C11 | Reviewed with evidence | graph |
| [src/thenable-subscription.js](../src/thenable-subscription.js) | C02 | Reviewed with evidence | root |
| [test/README.md](../test/README.md) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/action-throw-boundaries.test.js](../test/action-throw-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/array-backing-producers.test.js](../test/array-backing-producers.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-complete-collection.test.js](../test/array-complete-collection.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-consumption.test.js](../test/array-consumption.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-flat.test.js](../test/array-flat.test.js) | C15 / tests and tooling | Reviewed with evidence | root, graph |
| [test/array-flat-work.test.js](../test/array-flat-work.test.js) | C12, C15 / work and sensitivity | Reviewed with evidence | arrays, root, graph |
| [test/array-history-storage.test.js](../test/array-history-storage.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-intrinsic-boundaries.test.js](../test/array-intrinsic-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-length.test.js](../test/array-length.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-native-equivalence.test.js](../test/array-native-equivalence.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-preparation.test.js](../test/array-preparation.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-range-identity.test.js](../test/array-range-identity.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-range-recovery.test.js](../test/array-range-recovery.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-range-work.test.js](../test/array-range-work.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-search-ordering.test.js](../test/array-search-ordering.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-search.test.js](../test/array-search.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-sort-boundaries.test.js](../test/array-sort-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-transition-capture.test.js](../test/array-transition-capture.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-view-action-boundaries.test.js](../test/array-view-action-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/array-view.test.js](../test/array-view.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/boundary-contracts.test.js](../test/boundary-contracts.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/boundary-histories.test.js](../test/boundary-histories.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/boundary-lifetimes.test.js](../test/boundary-lifetimes.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/boundary-policy.test.js](../test/boundary-policy.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/browser-loading.test.js](../test/browser-loading.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/captured-inputs.test.js](../test/captured-inputs.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/captured-shape.test.js](../test/captured-shape.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/causal-failures.test.js](../test/causal-failures.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/chain.test.js](../test/chain.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/classification-failures.test.js](../test/classification-failures.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/complete-failures.test.js](../test/complete-failures.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/copied-delivery.test.js](../test/copied-delivery.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/data-classes.test.js](../test/data-classes.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/data-declarations.test.js](../test/data-declarations.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/declaration-failure-boundaries.test.js](../test/declaration-failure-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/detached-cleanup-boundaries.test.js](../test/detached-cleanup-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/enter.test.js](../test/enter.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/entry-identity-dependencies.test.js](../test/entry-identity-dependencies.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/entry-identity.test.js](../test/entry-identity.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/entry-storage.test.js](../test/entry-storage.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/entry-structure.test.js](../test/entry-structure.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/error-attribution.test.js](../test/error-attribution.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/error-union.test.js](../test/error-union.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/execution-context.test.js](../test/execution-context.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/experiments/array-iteration-contract-probes.mjs](../test/experiments/array-iteration-contract-probes.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/experiments/array-layout-technical-probes.mjs](../test/experiments/array-layout-technical-probes.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/experiments/array-method-specification-probes.mjs](../test/experiments/array-method-specification-probes.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/experiments/error-reporting-order.mjs](../test/experiments/error-reporting-order.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/experiments/phase2-ownership-model.mjs](../test/experiments/phase2-ownership-model.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/experiments/phase2-retirement.mjs](../test/experiments/phase2-retirement.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/export.test.js](../test/export.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/expression-boundary.test.js](../test/expression-boundary.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/external-array-length-boundaries.test.js](../test/external-array-length-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-binding-diagnostics.test.js](../test/external-binding-diagnostics.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-context.test.js](../test/external-context.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-coordination.test.js](../test/external-coordination.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-error-oracle.js](../test/external-error-oracle.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-error-oracle.test.js](../test/external-error-oracle.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-metadata.test.js](../test/external-metadata.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-paths.test.js](../test/external-paths.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-then-probe.test.js](../test/external-then-probe.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/external-tree.test.js](../test/external-tree.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fatal-execution.test.js](../test/fatal-execution.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/argument-preparation-failure.js](../test/fixtures/argument-preparation-failure.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/array-enumeration-work.js](../test/fixtures/array-enumeration-work.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-failure-release.mjs](../test/fixtures/array-failure-release.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-point-work.js](../test/fixtures/array-point-work.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-range-failure-retention.mjs](../test/fixtures/array-range-failure-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-range-work.js](../test/fixtures/array-range-work.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-reflection-release.mjs](../test/fixtures/array-reflection-release.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-remap-failure-retention.mjs](../test/fixtures/array-remap-failure-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-sequences.js](../test/fixtures/array-sequences.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-surface.mjs](../test/fixtures/array-surface.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-validation-retention.mjs](../test/fixtures/array-validation-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/array-view-failure-retention.mjs](../test/fixtures/array-view-failure-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/boundary-histories.js](../test/fixtures/boundary-histories.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/boundary-release.mjs](../test/fixtures/boundary-release.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/call-selection-release.mjs](../test/fixtures/call-selection-release.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/capture-fatal.mjs](../test/fixtures/capture-fatal.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/capture-output-identity-release.mjs](../test/fixtures/capture-output-identity-release.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/classification-declaration-failure.js](../test/fixtures/classification-declaration-failure.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/completed-work-retention.js](../test/fixtures/completed-work-retention.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/conflict-matrix.js](../test/fixtures/conflict-matrix.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/construction-retention.js](../test/fixtures/construction-retention.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/continuation-failure.js](../test/fixtures/continuation-failure.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/deferred-validation-retention.mjs](../test/fixtures/deferred-validation-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/detached-cleanup-failure.js](../test/fixtures/detached-cleanup-failure.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/discarded-argument-leaves.mjs](../test/fixtures/discarded-argument-leaves.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/enter-direct-import.js](../test/fixtures/enter-direct-import.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/entry-failure.js](../test/fixtures/entry-failure.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/entry-history-work.js](../test/fixtures/entry-history-work.js) | C15 / tests and tooling | Reviewed with evidence | graph, external |
| [test/fixtures/external-owner-release.mjs](../test/fixtures/external-owner-release.mjs) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/external-sequences.js](../test/fixtures/external-sequences.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/finite-flat.mjs](../test/fixtures/finite-flat.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays, graph |
| [test/fixtures/array-flat-work.mjs](../test/fixtures/array-flat-work.mjs) | C12, C15 / work measurement | Reviewed with evidence | arrays, root, graph |
| [test/fixtures/flat-completion.mjs](../test/fixtures/flat-completion.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/generated-runner-control.mjs](../test/fixtures/generated-runner-control.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/identity-work.js](../test/fixtures/identity-work.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/import-retention.js](../test/fixtures/import-retention.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/imported-path-lifetime.mjs](../test/fixtures/imported-path-lifetime.mjs) | C15 / tests and tooling | Reviewed with evidence | graph, external |
| [test/fixtures/inspection-failure-retention.mjs](../test/fixtures/inspection-failure-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/internal-stage-failure.js](../test/fixtures/internal-stage-failure.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/invocation-completion-failure.js](../test/fixtures/invocation-completion-failure.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/join-internal-failure.js](../test/fixtures/join-internal-failure.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/length-fork-work.js](../test/fixtures/length-fork-work.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/managed-capture-work.js](../test/fixtures/managed-capture-work.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/mutation-failure-retention.mjs](../test/fixtures/mutation-failure-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/native-authority-work.mjs](../test/fixtures/native-authority-work.mjs) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/native-error-data.mjs](../test/fixtures/native-error-data.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/nested-sequences.js](../test/fixtures/nested-sequences.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/outward-completion-failure.js](../test/fixtures/outward-completion-failure.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/outward-registration-release.mjs](../test/fixtures/outward-registration-release.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/owner-finalization-failure.js](../test/fixtures/owner-finalization-failure.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/ownership-destinations.js](../test/fixtures/ownership-destinations.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/ownership-interactions.js](../test/fixtures/ownership-interactions.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/ownership-lifecycle.js](../test/fixtures/ownership-lifecycle.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/ownership-work.js](../test/fixtures/ownership-work.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/path-release.mjs](../test/fixtures/path-release.mjs) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/path-selection-work.mjs](../test/fixtures/path-selection-work.mjs) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/pending-copy-work.js](../test/fixtures/pending-copy-work.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/pending-push-work.js](../test/fixtures/pending-push-work.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/pending-structural-publication.js](../test/fixtures/pending-structural-publication.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/placement-capture-failure-retention.mjs](../test/fixtures/placement-capture-failure-retention.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/placement-sequences.js](../test/fixtures/placement-sequences.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/preparation-authority.mjs](../test/fixtures/preparation-authority.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/preparation-back-references.mjs](../test/fixtures/preparation-back-references.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/preparation-output-release.mjs](../test/fixtures/preparation-output-release.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/preparation-sequences.js](../test/fixtures/preparation-sequences.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/preparation-work.js](../test/fixtures/preparation-work.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/prepared-boundaries.mjs](../test/fixtures/prepared-boundaries.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/promise-key-differential.js](../test/fixtures/promise-key-differential.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/public-surface-release.mjs](../test/fixtures/public-surface-release.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/publication-model.js](../test/fixtures/publication-model.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/publication-pairs.js](../test/fixtures/publication-pairs.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/publication-rejection-audit.js](../test/fixtures/publication-rejection-audit.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/queue-storage-release.mjs](../test/fixtures/queue-storage-release.mjs) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/fixtures/receiver-identity.mjs](../test/fixtures/receiver-identity.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/receiving-branch-poison.mjs](../test/fixtures/receiving-branch-poison.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/receiving-invocation-differential.mjs](../test/fixtures/receiving-invocation-differential.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/receiving-invocation-faults.mjs](../test/fixtures/receiving-invocation-faults.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/registration-release.mjs](../test/fixtures/registration-release.mjs) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/result-contract.mjs](../test/fixtures/result-contract.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/fixtures/snapshot-identity-lifetime.js](../test/fixtures/snapshot-identity-lifetime.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/snapshot-internal-failure.js](../test/fixtures/snapshot-internal-failure.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/fixtures/stable-receiving-categories.mjs](../test/fixtures/stable-receiving-categories.mjs) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/fixtures/suspended-mutator-fatal.js](../test/fixtures/suspended-mutator-fatal.js) | C15 / tests and tooling | Reviewed with evidence | root, external |
| [test/fixtures/terminal-release.mjs](../test/fixtures/terminal-release.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/generated-runner.js](../test/generated-runner.js) | C15 / tests and tooling | Reviewed with evidence | root, external |
| [test/generated-runner.test.js](../test/generated-runner.test.js) | C15 / tests and tooling | Reviewed with evidence | root, external |
| [test/generated-sequences.test.js](../test/generated-sequences.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/generated-settings.js](../test/generated-settings.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/generated-settings.test.js](../test/generated-settings.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/get-errors.test.js](../test/get-errors.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/graph-oracle.js](../test/graph-oracle.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/graph-oracle.test.js](../test/graph-oracle.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/has-error.test.js](../test/has-error.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/identity-lineage.test.js](../test/identity-lineage.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/import-progress.test.js](../test/import-progress.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/import.test.js](../test/import.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/imported-path-interactions.test.js](../test/imported-path-interactions.test.js) | C15 / tests and tooling | Reviewed with evidence | graph, external |
| [test/index-recovery.test.js](../test/index-recovery.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/input-preparations.test.js](../test/input-preparations.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/inspection-outcomes.test.js](../test/inspection-outcomes.test.js) | C15 / tests and tooling | Reviewed with evidence | root, external |
| [test/internal-stage-boundaries.test.js](../test/internal-stage-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/invocation-failure-boundaries.test.js](../test/invocation-failure-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/invocation-inputs.test.js](../test/invocation-inputs.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/invocation-preparation.test.js](../test/invocation-preparation.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/join-failure-boundaries.test.js](../test/join-failure-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/language-values.test.js](../test/language-values.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/managed-capture.test.js](../test/managed-capture.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/managed-invocation.test.js](../test/managed-invocation.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/managed-then-probe.test.js](../test/managed-then-probe.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/meta.test.js](../test/meta.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/method-result-identity.test.js](../test/method-result-identity.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/module-url.js](../test/module-url.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/native-equivalence-support.js](../test/native-equivalence-support.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/operation-lifecycle.test.js](../test/operation-lifecycle.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/operation-sequences.test.js](../test/operation-sequences.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/ordered-thenable.js](../test/ordered-thenable.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/ownership-isolation.test.js](../test/ownership-isolation.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/ownership.test.js](../test/ownership.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/parent-placements.test.js](../test/parent-placements.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/path-operations.test.js](../test/path-operations.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/pending-boundary-histories.test.js](../test/pending-boundary-histories.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/pending-copy-work.test.js](../test/pending-copy-work.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/pending-push-work.test.js](../test/pending-push-work.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/phase5-boundary-intersections.test.js](../test/phase5-boundary-intersections.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/phase5-execution-interactions.test.js](../test/phase5-execution-interactions.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/phase5-surface-intersections.test.js](../test/phase5-surface-intersections.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/placement-version-boundaries.test.js](../test/placement-version-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/poison-reception-attribution.test.js](../test/poison-reception-attribution.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/prepared-input-failure-boundaries.test.js](../test/prepared-input-failure-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/presence-summaries.test.js](../test/presence-summaries.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/promise-path-segments.test.js](../test/promise-path-segments.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/promises.test.js](../test/promises.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/public-exports.test.js](../test/public-exports.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/publication-failure-boundaries.test.js](../test/publication-failure-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/publication-failures.test.js](../test/publication-failures.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/publication-trace.test.js](../test/publication-trace.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/query-failures.test.js](../test/query-failures.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/receiving-contracts.test.js](../test/receiving-contracts.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/receiving-invocation-differential.test.js](../test/receiving-invocation-differential.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/receiving-order.test.js](../test/receiving-order.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/receiving-paths.test.js](../test/receiving-paths.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/refcounts.test.js](../test/refcounts.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/reflection-boundaries.test.js](../test/reflection-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | root, external |
| [test/repair-call-recovery.test.js](../test/repair-call-recovery.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/representation-identity.test.js](../test/representation-identity.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/run.test.js](../test/run.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/runtime-boundaries.test.js](../test/runtime-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/runtime-loaders.test.js](../test/runtime-loaders.test.js) | C15 / tests and tooling | Reviewed with evidence | root, arrays |
| [test/runtime-transform.js](../test/runtime-transform.js) | C15 / tests and tooling | Reviewed with evidence | root, arrays |
| [test/safeguard-evidence.test.js](../test/safeguard-evidence.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/safeguards/evidence.mjs](../test/safeguards/evidence.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/safeguards/fault-hook.mjs](../test/safeguards/fault-hook.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/safeguards/registry.mjs](../test/safeguards/registry.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/safeguards/run.mjs](../test/safeguards/run.mjs) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/scope-recovery.test.js](../test/scope-recovery.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/snapshot-failure-boundaries.test.js](../test/snapshot-failure-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/snapshot-identity.test.js](../test/snapshot-identity.test.js) | C15 / tests and tooling | Reviewed with evidence | external |
| [test/storage-settlement.test.js](../test/storage-settlement.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/stress.test.js](../test/stress.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/string-native-equivalence.test.js](../test/string-native-equivalence.test.js) | C15 / tests and tooling | Reviewed with evidence | arrays |
| [test/support.js](../test/support.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/supported-thenables.test.js](../test/supported-thenables.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/then-probe-boundaries.test.js](../test/then-probe-boundaries.test.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/trace-runtime.js](../test/trace-runtime.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/trace-state.js](../test/trace-state.js) | C15 / tests and tooling | Reviewed with evidence | root |
| [test/verify-parents.js](../test/verify-parents.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/verify-refcounts.js](../test/verify-refcounts.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/verify-storage.js](../test/verify-storage.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/verify-storage.test.js](../test/verify-storage.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
| [test/write-based-identity.test.js](../test/write-based-identity.test.js) | C15 / tests and tooling | Reviewed with evidence | graph |
