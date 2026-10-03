# Reviewing Phase 2: ownership and lifetime migration

This is a compact coverage guide for reviewing the [Phase 2 plan](../runtime-evolution-plan.md#phase-2-replace-permanent-sharing-with-maintained-ownership), its experiments, or its implementation. It explains why individually correct mechanisms fail when combined and turns that into an inventory of obligations to check. The plan owns design and implementation decisions; [audit.md](audit.md) owns the general method and [project-audit.md](project-audit.md) owns snapshot pinning and slicing. Read those first, and do not restate or re-decide the plan here.

Claude and Codex assembled this from audit rounds between 2026-09-30 and 2026-10-02. Phase 2 is implemented, so current reviews audit its implementation or hunt for bugs independently. The examples illustrate failure families and are already addressed in the plan; verify each against the current snapshot before reporting it.

## Why combinations fail

Before Phase 2, several conservative mechanisms made local code safe by default:

- Copy-on-write relied on the monotone `shared` flag, set by lookup, import, copying, Array derivation, and retained versions, together with read leases. Over-protection cost copies, never correctness.
- Phase 1's complete incoming relationships had no production consumer. The optional counter projection already affected Error and Promise query results.
- Retained metadata was never retired, so re-entry of an admitted identity was an early return.
- A raw result held across later writes stayed intact because lookup marked it shared.

Phase 2 replaces those defaults with precise facts that every route must maintain:

1. **Removing blanket protection.** Each route that actually writes shared storage needs its own replacement. Before Phase 2, direct indexed assignment and deletion on a native Array whose backing a live slice used were protected only by `shared`. Routes that already publish a replacement do not need one.
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
- **Witnesses.** Removing a safeguard must make at least one supported test fail. Passing tests and cited "production evidence" do not show this: several required safeguards could be deleted with the whole suite still green. The [safeguard registry](../../test/safeguards/registry.mjs) removes each registered safeguard in turn; see [Coordinating audits](#coordinating-audits). A safeguard no test misses is either an untested obligation or dead weight, and a probe through supported routes decides which.
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
- Deleting an absent property below the first path level can advance ancestor generations, and copy shared ancestors, before the absence is known. Phases 3 and 4 own no-op equivalence.
- A supported thenable's `then` may synchronously invoke only its newly supplied callback. Draining older callbacks inside `then` is unsupported; see [data-limitations.md](../data-limitations.md).
- Cleanup within a live execution is required. Retirement and its interactions are therefore the highest-risk area, not an optional feature.

## Failure families and reproductions

The rows below preserve the audit's failure families as implementation regression targets. They are not a list of current defects. Use the production fixtures and pinned revision; prototype source-hook implementations have been removed.

| Family | Required witness | Production evidence |
| --- | --- | --- |
| Removed protection | Retained slices survive indexed assignment/deletion; releasing the extra owner restores eligible reuse. | Ownership, ArrayView, and publication-failure tests. |
| Captured identity | Address reuse does not merge export generations, skip newly introduced Errors, report false search matches, or mistake a later Array generation for an ancestor. | Ownership interactions plus export and Error-query tests. |
| Capture ordering | Receiver protection precedes callback-capable argument preparation; the whole argument frontier survives an earlier body. | All 17 Array observations, native controls, and unused-input controls in ownership interactions; fresh-input tests. |
| Input handoff | Pending Chain/context initialization, assignment, lookup, and external results preserve producer values before later source writers; assignment links its captured RHS. | Ownership tests and indexed/unindexed self-assignment tests. |
| Source references | Pending captures, queries, exports, and calls release spent parents, siblings, inputs, and discarded shells. | Run `node --expose-gc test/fixtures/ownership-destinations.js` and the corresponding ownership-interactions fixture. |
| Release after fatal | Detached delivery cleanup clears its own state without an uncaught queued fatal. | Ownership destinations. |
| Runtime lifetime | Disconnected cycles retire; a root or independent retained use preserves the reachable region; internal backing cycles do not prove liveness. | Independent retirement model and randomized production reachability checks. |
| Runtime work | Early-exit reverse proof bounds one batch; ignored output does not accumulate owners or queued fallbacks inside direct or entered bodies. | Ownership work fixture; independent ownership model. Long live ancestry across separate commands remains an accepted cost. |
| Producer classification | Fresh ready slices and external snapshots remain alive until direct reception; source-held ready lookup needs no extra hold. | Ownership and external-context tests; complete-constructor work counts. |
| Imported re-entry | Validation copies retain imported protection, inactive versions still settle, and restoration repeats neither host inspection nor subscription. | Ownership destinations, input-preparation tests, and work counters. |
| Metadata separation | Retirement removes counter projections and reverse links while preserving forward logical values and version authority. | Ownership destinations and the independent parent/refcount verifiers. |
| Commit visibility | Nested bodies commit independently while unfinished input/copy work remains held; receiver publication and result delivery have distinct lifetimes. | Ownership interactions, mutation/entry tests, and the generated sequences. |
| Enforced handoff | Raw results retained across commands use explicit holders; clearing roots permits collection of abandoned ancestors. | Updated sequence fixtures and import-retention GC fixture. |
| Array representation | Exclusive point writes copy no prefix; retained views still trigger linear materialization. Pop/push with an unused physical tail retains its safe fallback. | Array point-work and ownership work fixtures; plan section 6 records the kept/reverted trials. |

## Review pitfalls observed

- **Finding-driven reading.** Enumerate obligations first.
- **Inferring causation from a set flag.** One review blamed seven Array methods on missing `shared` protection because the flag was set; disabling it showed they already publish replacements.
- **Model evidence treated as integration evidence.** `npm run test:ownership-model` checks the retirement algorithm against a forward-root oracle; it does not run production scheduling, publication, or Array storage. Check what any experiment or probe actually executes before generalizing its result.
- **The plan and its prototype disagree.** Compare the text with what the experiment executes, such as when reactivation happens.
- **Measuring the wrong observable.** `chain._state.value` reads the physical property; a published overlay can hold a different logical value. Use `readLanguageProperty` and the public API.
- **Cost measured along one axis.** Depth without fan-in; one final write without alternating loops.
- **Logical invariants applied to representation.** "Assignment never creates cycles" does not cover Array backing.
- **Defending unsupported or accepted behavior.** Check the support boundary and the accepted limits first.
- **Stale cross-references.** Fixtures and other phases can contradict a revised design; check Phases 1, 5, and 6 and their fixtures.
- **Snapshot drift.** The plan changed during several audits. Pin the snapshot and recheck before reporting.
- **Attribution instead of reproduction.** Cite the experiment, mode, or minimal sequence, not who found an issue.
- **Tests that pin representation.** An assertion that storage is copied rather than written in place, or that runtime-owned host input stays untouched, pins representation unless the contract promises it. Such a test can block a sound simplification; check it against [data-limitations.md](../data-limitations.md) before treating its failure as a defect.
- **Misreading fault runs.** A run without a test summary crashed; it is not clean. Count failing tests, not exit codes alone.
- **Coverage without the interaction.** Assert joint keys for the actual histories exercised. A held root makes cached re-entry an active-graph test; prove retirement before calling it retired re-entry. An early expected assertion failure can hide later failures: collect all issued checks and still verify final postconditions.

## Evidence and reporting

Every finding needs a supported operation sequence, the violated contract, and a reproducer or a precise missing proof. Mark evidence as executed (with command, mode, and result), reasoned, or proposed. State whether a failure occurs in production code or only under a partial ownership hook. Classify it as current, end-state risk, specification, performance, or optional improvement. Rank severity: process crash, silent corruption, and premature retirement first; then leaks; then extra copies and documentation drift. Say when a fix needs a decision from the user.

For an implementation review, attach actual code locations and executed verification to each applicable obligation in the existing inventory. Identify the enforcing boundary, trace its relevant callers and bypasses, and cite the regression, independent verifier, or measured work check. Explain when one executed check covers several routes through the same enforcement path. A plan paragraph or passing prototype alone cannot close an implementation obligation; keep specified, model-verified, and runtime-verified evidence distinct. Record remaining gaps explicitly: safeguard coverage in the registry below, other unresolved obligations in the plan. Do not start another tracking system.

## Coordinating audits

Several models audit this phase, sometimes at the same time. Keep shared state in the repository so each audit extends earlier work instead of repeating it:

- **Start from the witness map.** Run `npm run test:safeguards`, or `npm run test:safeguards -- <id> ...` for your slice, against your pinned snapshot. The [registry](../../test/safeguards/registry.mjs) is the only list of safeguard faults; do not keep a private one.
- **Keep deferred conformance visible.** Run `npm run test:known-issues:check` and inspect `npm run test:known-issues` failures. A matching baseline means known debt is unchanged, not that conformance passes. Changed symptoms require investigation; fixed witnesses move into the default suite.
- **Report by entry id.** An `open` entry is already known. Report it again only with new evidence, such as a supported consequence or a proof that none exists, and update its reason in the same change.
- **Add a test only where one is missing.** That means an entry that is `open` or `lost`, or a newly found safeguard. Before writing it, run the entry: if any test already fails, the witness exists. Add a second witness only for a distinct semantic consequence, and say which. Record the new test's title in `witnesses` in the same change.
- **One entry per safeguard.** Check existing ids and fault locations before adding one. Delete the entry when its safeguard is removed as redundant.
- **Keep probes disposable.** Retained evidence belongs in the normal suite, the registry, or the plan's open decisions. Do not add per-audit fixtures or runners for coverage the suite already has.
- **Recheck before reporting.** Results hold for the snapshot they ran on. If the tree has moved, re-run the affected entries before reporting them as current.

The runner first checks that the unmodified suite is clean. By default it then runs only each entry's listed witnesses, which takes seconds per entry. It falls back to the whole suite when no witness fails or the entry is open; `--full` always runs the whole suite and reports every affected test. Each entry is classified as:

| Status | Meaning and action |
| --- | --- |
| `witnessed` | A listed witness fails. Covered. A `--full` run notes when only one test fails at all (thin coverage). |
| `unlisted` | Only other tests fail. Confirm one is a semantic witness, not an incidental check such as a work-count marker, and list it. |
| `open` | No test fails and the entry explains why. Probe supported routes: a consequence calls for a regression; none calls for removal. |
| `lost` | No test fails and the entry is not marked open. Coverage regressed; restore a witness. |
| `witnessed-but-open` | The entry is marked open but a listed witness now fails. Remove `open`. |
| `stale` | The fault text no longer matches source. Update the fault, not the status. |
| `crashed` | The suite died before any test failed. The fault is detected but has no named witness; read the crash before relying on it. Other statuses marked "suite crashed" still name the tests that failed first. |

## Stages and audits

| Stage | What it should establish |
| --- | --- |
| Planning | Clear semantics, ownership and lifetime rules, complete responsibilities, and a plausible design for every required transition. It catches contradictions such as "release here, but use later", not whether every continuation releases the right reference. |
| Design experiments | Whether the hardest assumptions survive concrete counterexamples, timing variations, and work measurements across every axis. |
| Implementation | Whether actual code maintains the rules across every producer, consumer, publication, and release boundary, checked by the extended independent verifiers inside generated sequences. |
| Independent bug hunting | Whether combinations and assumptions escaped both design and implementation tests. |

Phase 2 has passed the first three stages. The rest of this section records how they were run, for re-audits and for later phases built the same way.

Follow the plan's [integration sequence](../runtime-evolution-plan.md#42-integration-sequence). At each step, check that every safeguard a step removes, such as `shared` on a route, has its replacement (handoff holds, captured generations, Array storage permission) in place first.

Begin implementation once required semantics and responsibilities have a plausible design and remaining uncertainties have bounded experiments and decision points. An unresolved experiment gates the representation or dependent change it must justify; it does not require another complete plan review before independent implementation work can begin. Complete each experiment's required evidence before relying on its result, and keep integrated acceptance separate from model success.

Use focused reviews at the high-risk integration points within the coherent Phase 2 change:

- As handoff and capture become executable, check synchronous callback delivery, the complete retained input frontier, and captured identity under storage reuse.
- As retirement is connected, check pending publication, working-copy holds, reactivation, source-reference release, and Array storage dependencies together. Resolve their required checks before making replacement ownership authoritative.
- After integration, audit the actual production replacement with `shared` removed and without correction hooks supplying missing holds, retirement, or generation handling. Diagnostic instrumentation may observe that path; pair it with the uninstrumented controls required by [test/README.md](../../test/README.md). Run the retained counterexamples as regressions, the relevant independent verifiers and generated sequences, the safeguard registry, and the required lifetime and work-count checks at the plan's acceptance scales.

Turn each confirmed defect into a regression, check sibling routes using the same mechanism, and re-audit affected interactions after the fix. Reopen architectural decisions when evidence contradicts their assumptions or exposes disproportionate complexity; routine wiring defects need focused correction and verification. If using multiple reviewers, assign complementary slices plus explicit ownership of interactions. Stop a review stage when its applicable obligations have owners, transition arguments, and stage-appropriate evidence, with findings resolved or explicitly recorded. Final acceptance requires resolution of required findings and the plan's completion criteria; neither a fixed number of reviews nor one quiet round establishes that.

## Probe toolkit

- Write review probes in a scratch directory and import production modules through `file://` URLs. A review alone does not authorize repository fixes; make them when requested, then retain useful regressions in the normal test harness.
- Drive behavior through `src/index.js`: `new Chain(value, ctx)`, `run(chain, path, method, args, ctx, facts)`, `assignPath`, `deletePath`, `enter`, `lookupPath`, and `ContextChain(value, ctx, mutationAccessTree)` with `externalState`. Use `{ execution: new Execution(), errorContext }` as the context.
- Read logical state with `readLanguageProperty` (`src/language-properties.js`), parent facts with `getParentPlacements` (`src/parent-placements.js`), and metadata with `metaOf` (`src/meta.js`).
- Test causality with process-local loader hooks (`registerHooks` from `node:module`): for example, make `requiresCopyOnWrite` ignore `preservationParents`, then observe whether a retained recovery baseline changes. For a registered safeguard, use `npm run test:safeguards -- <id>`; its hook also reaches fixtures the suite spawns.
- Count work instead of timing it: reuse the counting hooks in [ownership-work.js](../../test/fixtures/ownership-work.js), wrap an owner set's iterator, and count copies. Use `node --cpu-prof` and aggregate time beneath one function to locate a cost.
- Use GC witnesses with `--expose-gc` and `WeakRef`, keeping the execution and surviving children alive.
- Run crash, livelock, and memory probes in a subprocess with limits.
- Reuse the safeguard runner, the ownership model, and the existing fixtures and verifiers in [test/README.md](../../test/README.md) before writing new harnesses.
