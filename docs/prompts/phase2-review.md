# Reviewing Phase 2: ownership and lifetime migration

This is a compact coverage guide for reviewing the [Phase 2 plan](../runtime-evolution-plan.md#phase-2-replace-permanent-sharing-with-maintained-ownership), its experiments, or its implementation. It explains why individually correct mechanisms fail when combined and turns that into an inventory of obligations to check. The plan owns design and implementation decisions; [audit.md](audit.md) owns the general method and [project-audit.md](project-audit.md) owns snapshot pinning and slicing. Read those first, and do not restate or re-decide the plan here.

Claude and Codex assembled this from audit rounds between 2026-09-30 and 2026-10-01. Its examples illustrate failure families and most are already addressed in the plan. Verify each against the current snapshot before reporting it.

## Why combinations fail

Before Phase 2, several conservative mechanisms made local code safe by default:

- Copy-on-write relied on the monotone `shared` flag, set by lookup, import, copying, Array derivation, and retained versions, together with read leases. Over-protection cost copies, never correctness.
- Phase 1's complete incoming relationships had no production consumer. The optional counter projection already affected Error and Promise query results.
- Retained metadata was never retired, so re-entry of an admitted identity was an early return.
- A raw result held across later writes stayed intact because lookup marked it shared.

Phase 2 replaces those defaults with precise facts that every route must maintain:

1. **Removing blanket protection.** Each route that actually writes shared storage needs its own replacement. Direct indexed assignment and deletion on a native Array whose backing a live slice uses are protected only by `shared` today. Routes that already publish a replacement do not need one.
2. **Releasable protection.** Every hold now ends, and each release point is a hazard: ready-result expiry, the fallback microtask, pending-delivery release, and recovery dependencies ending on repair. Releases can run after a fatal error.
3. **Authoritative relationships.** Complete incoming relationships become authoritative for ownership and retirement. A missing or stale relationship now causes an in-place write into another owner's value or premature retirement, not an extra copy.
4. **Runtime-managed references and metadata lifetime.** Phase 1's incoming relationships are strong references from children to parents. Phase 2 must remove them, and every other runtime reference, when no use remains: registry entries, counter links, destination references, closures, and work fields. JavaScript still collects the memory, but only after the runtime drops its references. This brings cycle proofs, batching, activation candidates, and source-reference cleanup.
5. **Observable intermediate states.** Retirement runs at commit points, so previously invisible states become hazards: unpublished copies during bottom-up path reconstruction, parentless outputs before reception, and adopted receivers awaiting publication.
6. **Storage reuse breaks address-as-identity.** Once storage can change in place after its last protected use, one JavaScript address can denote different generations over time. Every consumer that remembers an identity across later work must capture generation identity instead.
7. **An enforced handoff contract.** "Receive results immediately" becomes load-bearing. Each producer must classify its result's lifetime, and tests or compiler patterns that relied on tolerance break.
8. **Separating semantic from disposable metadata.** Retirement drops bookkeeping but must preserve versions, overlays, admission, and imported protection for supported re-entry of cached host data.
9. **Explicit Array storage sharing.** Views share physical backing, so storage permission, representation cycles, and materialization costs become per-route concerns.
10. **New asynchronous entry points.** Queued releases enter the runtime outside any operation and must obey the fatal, re-entry, and batching rules.

Process causes compounded these:

- **The hard problems sit between mechanisms.** Input preparation, synchronous delivery, retirement, and language-body execution can each be correct separately while their interaction is wrong.
- **Experiments modeled too little.** A model can prove reachability while omitting a publication gap or a callback that retains an old parent.
- **Main-mechanism evidence was over-generalized** to the mechanism's consumers.
- **Reviews were finding-driven.** Enumerate obligations first, then look for problems.

## Coverage inventory

**Routes:**

| Family | Members |
| --- | --- |
| Public producers | `lookupPath`, including mutable-external snapshot lookups; `run` (managed methods, controlled Array methods, external calls); `enter` results; `import`; `importMethodResult`; Error queries; expression extraction |
| Receivers | Chain and ContextChain construction, `assignPath`, `deletePath`, call receivers and arguments (including receiver protection relative to argument preparation), entry anchors, export capture, higher-runtime forwarding |
| Mutation routes | Path writes, mutable entry capture, controlled Array mutation, managed native mutation with receiver adoption, external mutation, repair |
| Internal producers | Copy-on-write path copies, import and adoption copies, validation copies, observation materialization, mutable-external snapshot copies, Array derivation, remap |
| Identity consumers | Export caches, query visited sets, Array conversion and recursive traversal ancestry (`hasArrayAncestor`), identity searches (`includes`, `indexOf`, `lastIndexOf`) |
| Asynchronous entries | Resumed graph publication, pending-delivery release, ready fallback, synchronous thenable callbacks, trusted bodies (`runInternalStep`/`continueOperation` bodies, `enter` callbacks, compiler-controlled calls) |

**Facts:** incoming and outgoing placements; holder role; read leases; pending capture obligations; ready-delivery and pending-delivery holds; unfinished-mutation baselines; installed recovery dependencies, ready or pending; Array owner registration and physical occurrences; imported protection, including validation copies; publication holds for suspended work; destination references; counter-index state and reciprocal links; captured generation identity; and ordinary JavaScript references in closures and work fields, including spent arguments and receivers.

**Dimensions:** ready, synchronous custom thenable, pending, rejected, never-settling, fatal before and after; top level, inside a language body, inside an `enter` callback; indexed and unindexed; runtime-owned, imported, and validation copy; record, native Array, and ArrayView; aliases, logical cycles, and representation cycles; deep ancestry and wide fan-in; storage reused at the same address.

Do not try to fill the full product. For each **applicable obligation**, record an owner (the boundary responsible), a transition argument (acquire, transfer, release, retirement), and evidence appropriate to the stage. Mark inapplicable combinations with a reason. Share evidence where routes genuinely share one enforcement path, and name that path. A missing test is a verification gap; it does not by itself establish a runtime defect. Assign reviewers to slices of this inventory and give someone explicit ownership of cross-mechanism sequences.

## Review lenses

- **Failure direction.** If this fact is missing, stale, or inactive, is the result an extra copy or leak, or an in-place write or premature retirement? The plan already requires conservative copying for ambiguous cases and a valid path to a retained root for liveness. Check that each route applies those rules, and treat any route whose missing fact leads to corruption as high risk.
- **Causal testing.** A protective flag being set does not prove it is what protects. Disable the suspected mechanism in a scratch loader hook and observe the outcome before attributing protection to it.
- **Release timing.** Does release follow the last use on every path, including failure, local closure, a consumer that never arrives, and a fatal error before a queued release runs?
- **Commit visibility.** Can a batch drain while this route holds private state, an unpublished copy, or a parentless output? Which transition owns the drain?
- **Producer classification.** Is the result held by its source, fresh, removed from its placement, or a detached snapshot?
- **Identity under reuse.** Does any consumer remember an object across later work by address rather than by captured generation?
- **Representation versus logic.** Does a logical invariant, such as no cycles or one placement, survive Array backing, overlays, and physical occurrences?
- **Work along every axis.** Measure depth and fan-in, single and alternating operations, growth and stack patterns, per command rather than per body or microtask.
- **Support boundary and accepted limits.** Check [data-limitations.md](../data-limitations.md) and the list below before proposing a defense.

## Accepted limits

Do not report these as defects without new evidence. Each is a deliberate plan decision:

- Required never-settling work is not cancelled. Unfinished writers retain the holders their promised effects need.
- Fatal handling performs no execution-wide cleanup sweep. Reclaiming state captured by a never-settling host Promise after a fatal error is not guaranteed.
- Unused physical ranges within a backing that some owner still uses may remain; the whole backing is the reclamation unit. Suffix trimming is optional.
- JavaScript GC timing, host-lifetime discovery, and automatic compiler last-use analysis are not acceptance conditions.
- Host retention of an unexported runtime-owned value is unsupported. Do not add protection-transfer walks or host-lifetime tracking for it.
- The most recently exposed ready result may stay held until the next receiving transition or the fallback.
- Cached reactivation is eager, so an ignored cached result pays for restoration and retirement. Lazy reactivation is a separate optional experiment.
- Validation copies of imported nodes keep imported protection and accept the extra copying that causes.
- Root clearing still happens at the final live scope exit.
- Reverse liveness proofs pay for relevant ancestry across separate commands; constant-time release is not promised.
- Cleanup within a live execution is required. Retirement and its interactions are therefore the highest-risk area, not an optional feature.

## Failure families and reproductions

Classes: **current** (observable in the reviewed production snapshot); **end-state risk** (appears only after Phase 2 changes, or under a partial ownership hook); **specification** (plan, contract, or fixture gap); **performance**. The rows record audit evidence, not a live defect list. Recheck their status against the pinned snapshot and the plan's [executed evidence](../runtime-evolution-plan.md#executed-prototypes-and-selected-direction); distinguish a fixed model from an integrated runtime fix.

| Family | Example | Reproduction | Class |
| --- | --- | --- | --- |
| Removed protection | `a = [1, 2]`; `s = a.slice(0)` held in another Chain; assign or delete `a[0]`. The slice changes when copy-on-write ignores `shared`. | Minimal sequence with a scratch hook disabling `shared` in `requiresCopyOnWrite`; plan [section 3](../runtime-evolution-plan.md#3-one-cow-decision-using-those-facts) | End-state risk |
| Removed protection (non-example) | `sort`, `reverse`, `fill`, `splice`, `copyWithin`, `shift`, and `unshift` publish a replacement Array and keep the slice intact without `shared`. Do not add per-method copies. | Same hook; plan section 3 | None |
| Captured identity | `join` of `[1, pending]`, receiver elements replaced, `pending` fulfilled by a lookup of the later receiver: result is `"1,"` instead of `"1,2,3"` | `node test/experiments/phase2-interactions.mjs production`; plan Experiment C | Current |
| Captured identity | Identity searches report false matches when an address is reused | `phase2-interactions.mjs ownership` (hook covers ordinary record writes only) | End-state risk |
| Captured identity | Address-keyed export reuses the `{ k: 1 }` output for a later `{ k: 2 }` generation; query visited sets skip newly introduced Error data | Plan [section 2.4](../runtime-evolution-plan.md#24-captured-identity-when-storage-is-reused) and the storage-reuse counterexamples in [executed prototypes](../runtime-evolution-plan.md#executed-prototypes-and-selected-direction) | End-state risk |
| Capture ordering | Receiver protection acquired after callback-capable argument preparation in 17 Array observations | `phase2-interactions.mjs production` retains eight cases; correction trial in `receiver` mode. The plan's executed evidence records the expanded 39-case probe; [section 5](../runtime-evolution-plan.md#5-verification-and-completion-criteria) lists all 17 methods, their native-Promise controls, and five unused-input controls. | Current |
| Source references | Spent call arguments retain their sources | `node --expose-gc test/experiments/phase2-interactions.mjs production`; correction trial in `arguments` mode | Current |
| Source references | `PropertyPlacement.owner`, Error-query source parameters, export callbacks, and shared traversal closures retain retired sources | `node --expose-gc test/experiments/phase2-destinations.mjs`; plan [section 2.3](../runtime-evolution-plan.md#23-retirement-and-relationship-lifetime) | End-state risk |
| Release after fatal | A queued release that enters a fatal-throwing transition after `failExecution` exits the process | Minimal sequence: `failExecution(ctx, error)`, then `queueMicrotask(() => runInternalStep(ctx, work))`; plan section 5 detached-cleanup bullet | End-state risk |
| Runtime lifetime | `x -> oldParent -> child` with `y -> child`: the reverse edge pins `oldParent` | Plan section 2.3 | Specification |
| Runtime lifetime | `a.push(a)` is logically `[[]]` while its backing contains itself | `node test/experiments/phase2-retirement-runtime.mjs` | End-state risk |
| Runtime lifetime | The earlier full-region reverse proof cost N + 2 visits to release one lease on a child shared by N rows. The selected batch-local proof now examines three parent edges when the three-edge root path comes first. | `node test/experiments/phase2-retirement.mjs` checks early exit, cycles, failed branches, and batch reuse against the independent oracle. Runtime dependency integration and Array owner enumeration remain Experiment A obligations. | Performance; corrected in model, integration pending |
| Runtime lifetime | N mutating pushes leave N + 1 registered owners; early-exit ownership checks become quadratic | `phase2-retirement-runtime.mjs`, `phase2-ready-handoff.mjs`; plan section 5 owner-history measurement | Current retention; performance once copy-on-write uses parents |
| Producer classification | A ready `slice` result has zero parents until its receiving Chain attaches | `phase2-ready-handoff.mjs`; plan [ready leases](../runtime-evolution-plan.md#brief-leases-for-ready-outputs) | End-state risk |
| Producer classification | Each lookup into a registered mutable external resource returns a fresh managed copy with zero parents | `ContextChain({ db: externalState(new Db()) }, ctx, { db: {} })`, then `lookupPath(["db", "config"])` twice; plan integration step 1 | End-state risk |
| Imported re-entry | Validation copy `C2` of an imported child must keep imported protection, or cached re-entry changes value | Validation-copy probes in `phase2-ready-handoff.mjs`; plan [imported protection](../runtime-evolution-plan.md#imported-protection-and-supported-re-entry) | End-state risk |
| Imported re-entry | Imported native Arrays own their backing record and keep logical state in overlays that retirement must preserve | Plan section 2.3 Array owner rules | Specification |
| Metadata separation | Retired counter summaries stop receiving child updates and become stale on re-entry | `phase2-destinations.mjs` counter rebuild checks; plan Experiment B | Specification |
| Metadata separation | Reactivation during a fallible import walk restores relationships before the segment commits | Plan section 2.3 reactivation rule and Phase 6 constraints; the destinations probe still reactivates during the walk | Specification |
| Commit visibility | A nested body during preparation retired an immediately received slice and changed a result to `[2]` | Plan executed-prototypes storage-reuse and preparation counterexamples | End-state risk |
| Commit visibility | A pending managed mutation adopts its receiver before publication resumes two reactions later | Plan section 2.3 boundary rules and section 5 | Specification |
| Enforced handoff | Tests hold raw lookups across later writes and assert they are unchanged | `test/operation-sequences.test.js`; plan integration step on test migration | Specification |
| Enforced handoff | Phase 1's `test/fixtures/import-retention.js` expects ancestor retention that Phase 2 forbids | Plan Phase 1 retirement note | Specification |
| Array representation | One point write after N pushes materializes the whole Array, through assignment and mutable entry; alternating loops copy quadratic volume | `node test/experiments/phase2-array-point-writes.mjs`; plan [section 6](../runtime-evolution-plan.md#6-array-mutation-performance-experiments) | Performance (current) |
| Array representation | Stack-style `pop` then `push` allocates a new backing per pair | Plan section 6.2 | Performance (current) |

## Review pitfalls observed

- **Finding-driven reading.** Enumerate obligations first.
- **Inferring causation from a set flag.** One review blamed seven Array methods on missing `shared` protection because the flag was set; disabling it showed they already publish replacements.
- **Model evidence treated as integration evidence.** Check what each experiment hooks: one runner opens transitions at public wrappers and covers ready commands only; another selects retirement explicitly; the `ownership` mode covers ordinary record writes only.
- **The plan and its prototype disagree.** Compare the text with what the experiment executes, such as when reactivation happens.
- **Measuring the wrong observable.** `chain._state.value` reads the physical property; a published overlay can hold a different logical value. Use `readLanguageProperty` and the public API.
- **Cost measured along one axis.** Depth without fan-in; one final write without alternating loops.
- **Logical invariants applied to representation.** "Assignment never creates cycles" does not cover Array backing.
- **Defending unsupported or accepted behavior.** Check the support boundary and the accepted limits first.
- **Stale cross-references.** Fixtures and other phases can contradict a revised design; check Phases 1, 5, and 6 and their fixtures.
- **Snapshot drift.** The plan changed during several audits. Pin the snapshot and recheck before reporting.
- **Attribution instead of reproduction.** Cite the experiment, mode, or minimal sequence, not who found an issue.

## Evidence and reporting

Every finding needs a supported operation sequence, the violated contract, and a reproducer or a precise missing proof. Mark evidence as executed (with command, mode, and result), reasoned, or proposed. State whether a failure occurs in production code or only under a partial ownership hook. Classify it as current, end-state risk, specification, performance, or optional improvement. Rank severity: process crash, silent corruption, and premature retirement first; then leaks; then extra copies and documentation drift. Say when a fix needs a decision from the user.

For an implementation review, attach actual code locations and executed verification to each applicable obligation in the existing inventory. Identify the enforcing boundary, trace its relevant callers and bypasses, and cite the regression, independent verifier, or measured work check. Explain when one executed check covers several routes through the same enforcement path. A plan paragraph or passing prototype alone cannot close an implementation obligation; keep specified, model-verified, and runtime-verified evidence distinct. Record remaining gaps explicitly rather than starting a separate tracking system.

## Stages and audits

| Stage | What it should establish |
| --- | --- |
| Planning | Clear semantics, ownership and lifetime rules, complete responsibilities, and a plausible design for every required transition. It catches contradictions such as "release here, but use later", not whether every continuation releases the right reference. |
| Design experiments | Whether the hardest assumptions survive concrete counterexamples, timing variations, and work measurements across every axis. |
| Implementation | Whether actual code maintains the rules across every producer, consumer, publication, and release boundary, checked by the extended independent verifiers inside generated sequences. |
| Independent bug hunting | Whether combinations and assumptions escaped both design and implementation tests. |

Follow the plan's [integration sequence](../runtime-evolution-plan.md#42-integration-sequence). At each step, check that every safeguard a step removes, such as `shared` on a route, has its replacement (handoff holds, captured generations, Array storage permission) in place first.

Begin implementation once required semantics and responsibilities have a plausible design and remaining uncertainties have bounded experiments and decision points. An unresolved experiment gates the representation or dependent change it must justify; it does not require another complete plan review before independent implementation work can begin. Complete each experiment's required evidence before relying on its result, and keep integrated acceptance separate from model success.

Use focused reviews at the high-risk integration points within the coherent Phase 2 change:

- As handoff and capture become executable, check synchronous callback delivery, the complete retained input frontier, and captured identity under storage reuse.
- As retirement is connected, check pending publication, working-copy holds, reactivation, source-reference release, and Array storage dependencies together. Resolve their required checks before making replacement ownership authoritative.
- After integration, audit the actual production replacement with `shared` removed and without correction hooks supplying missing holds, retirement, or generation handling. Diagnostic instrumentation may observe that path; pair it with the uninstrumented controls required by [test/README.md](../../test/README.md). Run the retained counterexamples as regressions, the relevant independent verifiers and generated sequences, and the required lifetime and work-count checks at the plan's acceptance scales.

Turn each confirmed defect into a regression, check sibling routes using the same mechanism, and re-audit affected interactions after the fix. Reopen architectural decisions when evidence contradicts their assumptions or exposes disproportionate complexity; routine wiring defects need focused correction and verification. If using multiple reviewers, assign complementary slices plus explicit ownership of interactions. Stop a review stage when its applicable obligations have owners, transition arguments, and stage-appropriate evidence, with findings resolved or explicitly recorded. Final acceptance requires resolution of required findings and the plan's completion criteria; neither a fixed number of reviews nor one quiet round establishes that.

## Probe toolkit

- Write review probes in a scratch directory and import production modules through `file://` URLs. A review alone does not authorize repository fixes; make them when requested, then retain useful regressions in the normal test harness.
- Drive behavior through `src/index.js`: `new Chain(value, ctx)`, `run(chain, path, method, args, ctx, facts)`, `assignPath`, `deletePath`, `enter`, `lookupPath`, and `ContextChain(value, ctx, mutationAccessTree)` with `externalState`. Use `{ execution: new Execution(), errorContext }` as the context.
- Read logical state with `readLanguageProperty` (`src/language-properties.js`), parent facts with `getParentPlacements` (`src/parent-placements.js`), and metadata with `metaOf` (`src/meta.js`).
- Test causality with process-local loader hooks (`registerHooks` from `node:module`): for example, make `requiresCopyOnWrite` ignore `shared`, then observe whether the protected value changes.
- Count work instead of timing it: wrap an owner set's iterator, use the metrics in `phase2-ownership-model.mjs`, and count copies. Use `node --cpu-prof` and aggregate time beneath one function to locate a cost.
- Use GC witnesses with `--expose-gc` and `WeakRef`, keeping the execution and surviving children alive.
- Run crash, livelock, and memory probes in a subprocess with limits.
- Reuse the runners in `test/experiments/`, with their documented modes, before writing new ones.
