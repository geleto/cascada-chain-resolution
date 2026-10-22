# Manually repeat the Phase 5 review

Phase 5 is complete on its [2026-10-22 candidate](../phase5-review.md). Start another run only when the user requests it. Available tokens, a new model or subsequent code changes can motivate a manual request; they do not initiate work automatically.

## Invocation

The user can start a fresh full review with:

> Re-run Phase 5 using docs/prompts/phase5-rerun.md. Review the current implementation from the contracts, investigate and fix supported defects, and record this run separately from the original closure.

A request may instead name a narrower question, such as pending publication after retirement, or explicitly request review without implementation. Honor that scope. With no narrower scope, review all Phase 5 obligations, including unchanged code. A focused pass must identify the obligations it did not revisit.

## Establish this run

1. Create a separate report at `docs/phase5-reruns/YYYY-MM-DD-NN.md`, using a new sequence number for another run on the same date. Record the requested scope, reason for the run, reviewer/model/version when known, any requested resource limit, repository revision and working-tree changes. Unknown model details remain unknown.
2. Read the current [AGENTS.md](../../AGENTS.md), [data contract](../data-limitations.md), [Phase 5 specification](../phase5-stabilization.md) and [systematic audit method](audit.md). Derive the sequential behavior, state transitions, ownership and last-use obligations from those contracts and the current source before adopting conclusions from earlier reviews.
3. Capture hashes of production sources, tests, fixtures, loaders, configuration and other execution inputs, including untracked files. Record relevant contract revisions and the Node, test-runner and host environment. A commit ID alone does not identify a dirty candidate. Keep an initial manifest and a final manifest if fixes change the candidate.
4. Then reconcile the previous [review and route/resource inventories](../phase5-review.md), [acceptance evidence](../phase5-acceptance.json) and [sensitivity mapping](../phase5-sensitivity.json). Treat them as evidence with stated limits. Preserve the original closure and JSON artifacts; save new evidence beside this run's report, for example `YYYY-MM-DD-NN-acceptance.json` and `YYYY-MM-DD-NN-sensitivity.json`.

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

The specification remains authoritative for full acceptance. The original closure's 54 jobs are a reproducible inventory, not a permanent job-count target. Reconcile it with the current wrappers and fixtures, especially stack limits 10, 50 and 1,000 for relevant failure-retention cases. Retain the strict B22 work/sensitivity controls, all eight required 1,600-seed families, complete conflict/publication-pair partitions, and per-obligation sensitivity. Derive expected counts from the current generators and checked joint combinations; old test totals are historical results.

## Execute and record required validation

Use the repository's [test guide](../../test/README.md#scaling-generated-runs) and the saved acceptance record's `runs[].command` and `runs[].env` to reconstruct commands. The original temporary orchestration scripts are not required inputs. Adapt checkout-specific loader URLs and report/receipt paths to this run; use fresh filenames and preserve structured arguments and actual newlines. A recorded null environment value means unset that variable. Clear inherited seed/start/partition/fault settings that could silently narrow a run, and supply the intended tracer explicitly.

Run clean baseline checks before counting safeguard faults. Use `--skip-baseline` only when a clean matching baseline has been verified and cited. The complete registry's normal mode uses named witnesses and fallback; it does not claim the separate `--full` whole-suite-per-fault mode. Check current anchors and the exact assertion each removal reaches. Record non-detecting selectors, counter-only evidence, incomplete attempts and infrastructure failures honestly.

Keep source/test inputs stable during each acceptance batch. Check hashes before and after, attribute partitions to their exact inputs, and invalidate affected results after edits. Use bounded process concurrency and deadlines with startup margin. Assert actual runtime execution in child processes; loader startup is insufficient. Preserve explicit untraced VM or negative-control qualifications, and distinguish reused process IDs by ordered process instances.

Record commands, environment overrides, exit status, counts, failures/skips, duration, manifests and receipt/report hashes. Retain enough portable diagnostics, fault edits and provenance to assess the outcome after temporary logs disappear. A timeout under load needs investigation or a suitable rerun, not pass credit. Do not repeatedly rerun already adequate checks without a new change, failure or unresolved concern.

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
New evidence files and links to earlier runs:
```

Completion means the declared obligations have current evidence and no known actionable present-contract defect or unexplained required evidence gap remains. If work stops earlier, report precisely what is unfinished; a resource limit does not turn an incomplete review into a clean verdict. A newly found supported defect reopens its family and affected validation, even when the original Phase 5 milestone was complete.

Keep the original closure historical. Link the new report from the Phase 5 execution record and update any current status affected by its findings; do not rewrite earlier results as though they ran on the new candidate. An unchanged clean rerun records what was newly examined and what evidence was reused. Phase 5 stays complete between manually initiated runs, subject to any explicitly recorded unresolved finding.
