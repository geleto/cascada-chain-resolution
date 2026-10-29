# Manually repeat the Phase 5 review

The latest accepted Phase 5 candidate and concise history are in the [current review](../phase5-review.md). Start another run only when the user requests it. Available tokens, a new model or subsequent code changes can motivate a manual request; they do not initiate work automatically.

## Invocation

The user can start a fresh full review with:

> Re-run Phase 5 using docs/prompts/phase5-rerun.md. Review the current implementation from the contracts, investigate and fix supported defects, and refresh the consolidated review and evidence.

A request may instead name a narrower question, such as pending publication after retirement, or explicitly request review without implementation. Honor that scope. With no narrower scope, review all Phase 5 obligations, including unchanged code. A focused pass must identify the obligations it did not revisit.

## Establish this run

1. Assign a run ID `YYYY-MM-DD-NN`. Record scope, reason, reviewer/model/version when known, resource limits, revision and working-tree changes. Unknown model details remain unknown. Mark the active review in `docs/phase5-review.md`; keep the prior accepted evidence intact until its replacement is verified. Store working manifests, logs, receipts, drafts and orchestration outside the repository. Do not create a permanent directory of per-agent or per-attempt reports.
2. Read the current [AGENTS.md](../../AGENTS.md), [data contract](../data-limitations.md), [Phase 5 specification](../phase5-stabilization.md) and [systematic audit method](audit.md). Derive the sequential behavior, state transitions, ownership and last-use obligations from those contracts and the current source before adopting conclusions from earlier reviews. Identify which approved slices the source candidate actually implements. For each revision not yet landed, use the applicable [current external-boundary baseline](../data-limitations.md#current-external-boundary-baseline) item for permanent cross-context conflicts, reservation-ordered repair, predecessor-held read completion and broad computed fallback; approved/not-implemented deltas are not the current oracle. Adjacent current requirements remain binding, including B10 rechecks, capture before later gates, prefix-only forbidden validation, predecessor retention by replacing reservations and contained entry completion. The B10 authority gap and B16 sibling-progress defect remain actionable under that baseline. A focused rerun does not require landing the registration revision first; record and validate any deliberately included policy cutover explicitly. In particular, B16 wrapper removal and obsolete managed-prefix/candidate reservation removal land with ready-key local failure and failed-repair preservation: compare static/computed pending-intermediate failures and subsequent sibling writes under that new oracle, plus progress past an unrelated pending native sibling and rejection of tree-proven invalid mixed managed scopes. Preserve actual native-prefix metadata ordering and fixed entry coverage; B16 includes failed-repair preservation on managed-prefix and static-owner routes, keeping earlier prefix Error precedence, and tests a computed explicit bang against its own pending resource. It does not wait for the separate computed query/repair enablement and collection changes. Record the pending-recovery call defect with its [independent early Phase 6 correction](../runtime-evolution-plan.md#repair-and-call-recovery-fix); do not treat its fix as a prerequisite to Phase 5 or gate it on the larger local-failure slice. Preserve it as a known unresolved finding until that focused correction is validated under B11/B16 and the affected lifetime/publication obligations. After the required correction review, close this finding without waiting for unrelated policy changes or the rest of Phase 6. Repair alone must not await its baseline, while the subsequent call must consume receiver availability normally. Structural rejection preserves the old guard; value-revealed authority failure after repair produces new call poison without host access. Do not require the old broad failure result after removing the mechanism that orders it.
3. Capture hashes of production sources, tests, fixtures, loaders, configuration and other execution inputs, including untracked files and auxiliary probes. Record relevant contract revisions and the Node, test-runner and host environment. A commit ID alone does not identify a dirty candidate. Keep initial/final working manifests when fixes change the candidate; retain one complete manifest per candidate still supporting reusable evidence, with references from its jobs. Do not repeat manifests in component reports or each job.
4. Then reconcile the [current review and route/resource inventories](../phase5-review.md), [acceptance evidence](../phase5-acceptance.json) and [sensitivity mapping](../phase5-sensitivity.json). These three files are the maintained baseline. Historical ledger entries retain their original date, scope and outcome; they do not substitute for retained, applicable execution evidence. Older artifacts removed during consolidation are not dependencies of a subsequent run.

## Perform a fresh review

For a full pass, give every B01-B22 obligation a current disposition. Reconstruct the relevant callers, bypass producers, state transfers and exits, including interactions between rows. Check the implementation and the tests' assumptions; repeating the previous conclusions or increasing seed counts alone does not establish a fresh review.

Use concrete hypotheses to direct deeper work:

- Compare an explicit all-ready sequential execution with synchronous custom and deferred delivery, including reads around mutations and failed prerequisites. Establish ordering before suspension and distinguish required pending dependencies from introduced cycles or unnecessary waits.
- Trace ownership, version authority, retirement/re-entry and shared settlement after local closure through every relevant producer and consumer. Prove actual retirement and retained-value isolation in reproductions.
- Check last access through success, failure and abandoned output. Retain unformatted fresh/prebuilt errors with healthy/live controls where diagnostic stacks can hold spent state. Include existing fixtures as well as new ones.
- Count aggregate work and live maintained state over long histories. Account for costs moved into backing producers, memberships, captures, subscriptions or forwarding records; distinguish requested retained output from obsolete history.
- Challenge independent oracles, normalization, observed versus bare execution, joint coverage and actual child instrumentation. Inspect intended fault diagnostics rather than trusting titles, anchor matches or process exits.

Reduce each supported defect through public operations, establish its causal invariant, inspect sibling routes, and retain a regression. Fix the authoritative mechanism and remove superseded paths. Follow the existing architecture-decision rules for a semantic change or material unresolved design tradeoff; neither a stronger model nor a previous implementation authorizes a new contract. Unsupported programming-interface corruption stays outside the audit's supported semantics.

## Reuse evidence deliberately

Classify every required gate as **newly executed**, **reused with justification**, **invalidated/pending**, or **outside the declared focused scope**. Reused results retain their original date and candidate; do not present them as newly executed tests. A full review cannot close with a required gate pending or outside scope.

| Situation | Evidence treatment |
| --- | --- |
| Same execution inputs and compatible environment; new reviewer or review notes only | Verify the recorded hashes and limits, then reuse applicable results. Spend new execution on concrete hypotheses and missing cases. |
| New regression, changed generator, oracle, verifier, loader or fault witness | Run the changed tests and affected instrumentation/sensitivity checks. Earlier results do not certify the new test/tool bytes. |
| Local production correction | Re-run its regression, sibling mechanisms and affected normal/traced, fault, lifetime and work gates. Document any unaffected expensive evidence reused, including the dependency argument. |
| Shared transition/representation change, changed execution environment, or an uncertain affected boundary | Reopen the applicable broad gates. Shared-mechanism changes require the larger configurations in the test guide; uncertainty is not evidence that a result is unaffected. |
| Changed contract | Obtain the required architecture decision, revise affected oracles and documentation, and validate the changed obligations. |
| Missing raw investigation artifacts | Use retained, reproducible evidence only for claims it supports. Reconstruct or rerun a required claim that cannot be checked; a temporary path or hash alone does not establish its result. |

The specification remains authoritative for full acceptance. The current acceptance record's `runs` and `supplementalRuns` are a starting command inventory, not a permanent job-count target. Reconcile them with the current wrappers and fixtures, especially stack limits 10, 50 and 1,000 for relevant failure-retention cases. Retain the strict B22 work/sensitivity controls, all eight required 1,600-seed families, complete conflict/publication-pair partitions, and per-obligation sensitivity. Derive expected counts from the current generators and checked joint combinations; old test totals are historical results.

## Execute and record required validation

Use the repository's [test guide](../../test/README.md#scaling-generated-runs) and each saved job's `command` and `env` to reconstruct commands. The original temporary orchestration scripts are not required inputs. Expand `${TRACE_RUNTIME_URL}` to this checkout's absolute tracer file URL and `${OUTPUT}` to a fresh output directory. Commands run from the repository root with structured arguments and actual newlines. A null environment value means unset that variable. First clear all inherited `CASCADA_*` variables and `NODE_OPTIONS`, then apply the recorded overrides. Auxiliary probes live in `docs/phase5-probes`; use their current paths and hashes, not historical `executedPath` labels.

Run clean baseline checks before counting safeguard faults. Use `--skip-baseline` only when a clean matching baseline has been verified and cited. The complete registry's normal mode uses named witnesses and fallback; it does not claim the separate `--full` whole-suite-per-fault mode. Check current anchors and the exact assertion each removal reaches. Record non-detecting selectors, counter-only evidence, incomplete attempts and infrastructure failures honestly.

Keep source/test inputs stable during each acceptance batch. Check hashes before and after, attribute partitions to their exact inputs, and invalidate affected results after edits. Use bounded process concurrency and deadlines with startup margin. Assert actual runtime execution in child processes; loader startup is insufficient. Preserve explicit untraced VM or negative-control qualifications, and distinguish reused process IDs by ordered process instances.

Record commands, environment overrides, exit status, counts, failures/skips, duration, input references and receipt/report hashes. Verify raw logs and ordered execution receipts while available, then retain sufficient self-contained results and diagnostics in the consolidated records. A hash of an unavailable log is provenance, not the result itself. A timeout under load needs investigation or a suitable rerun, not pass credit. Do not repeatedly rerun already adequate checks without a new change, failure or unresolved concern.

## Close this run

A full run requires a final reviewer who did not author its production fixes, as specified by Phase 5. Record the reviewer and reviewed candidate, resolve findings and obtain re-review of corrections. If that review is unavailable, leave this run's closure pending. Reuse of earlier execution evidence does not replace a fresh source review of the declared scope.

Use the following report outline:

```text
Status: in progress | complete within declared scope | incomplete
Requested scope and reason:
Reviewer/model/version (when known) and independent final reviewer:
Initial/final candidate manifests, revision, dirty files and environment:
Contract-derived questions and source traces:
B01-B22 dispositions (or explicit focused subset and exclusions):
Findings: supported reproduction, causal invariant, fix, regression, sibling review:
Validation: gate, new/reused/pending/outside-scope, candidate, evidence, reuse rationale:
Sensitivity: obligation, actual fault/witness/diagnostic/receipt, limits:
Independent review and correction re-review:
Remaining issues, exclusions and confidence limits:
Current evidence references and concise historical ledger entry:
```

Completion means the declared obligations have current evidence and no known actionable present-contract defect or unexplained required evidence gap remains. If work stops earlier, report precisely what is unfinished; a resource limit does not turn an incomplete review into a clean verdict. A newly found supported defect reopens its family and affected validation, even when the original Phase 5 milestone was complete.

Update current status without relabeling earlier results as newly executed evidence. An unchanged clean rerun records what was newly examined and what was reused. Phase 5 stays complete between manually initiated runs, subject to explicitly recorded unresolved findings.

## Consolidate at closure

Maintain these artifacts rather than adding another permanent report tree:

- `docs/phase5-review.md`: current candidate/scope, B01–B22 dispositions, useful source and resource traces, findings and causal fixes, independent reviewer/decision, limitations, and a short dated history of earlier outcomes and lasting design decisions. Merge component reviews; remove duplicate narratives and obsolete investigations.
- `docs/phase5-acceptance.json`: one manifest per still-used candidate, compatible environment and semantic-contract fingerprints, structured command/environment inventory, results and work measurements, shared joint-coverage sets, ordered instrumentation summaries, qualifications, and independent approval provenance. Keep supplemental jobs explicit. Never silently repin earlier results after changing inputs.
- `docs/phase5-sensitivity.json`: current obligation mapping, exact fault edits, selectors, failed-test titles, intended assertion diagnostics and matching child receipts. Keep at least one actual diagnostic for each detecting declared selector and any additional evidence needed by distinct mapped obligations. Deduplicate repeated diagnostics; retain non-detecting selectors and incomplete/crashed-attempt limitations. Titles, anchor matches and startup receipts alone are insufficient.
- `docs/phase5-probes/`: only executable probes still used by the current acceptance inventory or needed for an unresolved finding. Prefer a retained regression in the normal test harness when practical. Use descriptive stable names for genuinely reusable probes; keep one-off orchestration and report-generation scripts outside the repository.

Before replacement, reconcile the consolidated artifacts against the source records: every required job and obligation remains represented; commands, environments, candidate hashes, coverage sets, faults, diagnostics and actual instrumentation agree. Check all links and executable paths. For probe relocation, preserve bytes and relative imports where possible, record the old-to-current path and hash, and validate execution at the new location. Relocation verification is separate from prior runtime acceptance.

After verification, remove superseded acceptance/sensitivity snapshots, duplicate manifests, raw logs already represented by adequate retained evidence, per-agent results, failed draft/startup records, obsolete runners and abandoned probes. Summarize a resolved infrastructure failure only where it explains accepted provenance. Keep raw diagnostics that cannot be represented adequately by the retained evidence; do not manufacture a clean summary. Never prune an unresolved reproducer, or older evidence still actively reused by a focused run. Such reused evidence retains its own candidate/environment reference until replaced.

This retention policy preserves the next run's baseline and the reasons behind current mechanisms. It does not require indefinitely archiving every intermediate file, prior candidate or transcript. Documentation-only consolidation is not a new runtime acceptance or independent review; identify any changed documentation hashes separately and preserve the reviewed candidate identity.
