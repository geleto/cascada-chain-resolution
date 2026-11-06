# Whole-project audit and repair

Use this prompt for an autonomous audit of the whole repository, with implementation of clear fixes and a durable report of everything requiring further judgment. Start it from the repository root in a new chat:

```text
/goal Complete the whole-project audit and repair described in docs/prompts/audit-and-fix.md. Audit all current code and supported functionality, implement and verify every finding with a clear contract-preserving solution, and record unresolved issues and design decisions in docs/audit-report.md. Continue through the coverage and completion criteria in that prompt.
```

## Objective and authority

Audit the entire project for correctness defects, missing required behavior, architectural weaknesses, unnecessary complexity, poor abstractions, inconsistent implementation, resource and performance problems, unreliable tests, and documentation drift. Evaluate both individual components and their interactions from first principles.

This is an implementation task as well as a review. You are authorized to make coherent fixes, refactorings, deletions, tests, and documentation corrections that preserve established semantics. Do not stop after producing a plan or finding the first few defects. Do not limit the audit to recent changes or known problem areas.

Read and apply:

- `AGENTS.md` and any applicable nested instructions;
- `docs/data-limitations.md` and the relevant architecture and API contracts;
- `docs/prompts/project-audit.md` for project-wide organization;
- `docs/prompts/audit.md` for the investigation and evidence method;
- `docs/feature-review-prompt.md` for first-principles design review;
- `docs/coverage-tree.md`, `test/README.md`, and relevant existing plans and review records.

This request supplies the fix authorization absent from the review-only defaults in those prompts. Their evidence and support-boundary requirements still apply. For this task, record proposed semantic changes in the report for later discussion instead of interrupting the audit to ask about each one. Continue independent work under the current contract.

Question requirements, assumptions, semantics, foundational principles, and implementation choices, including those in `AGENTS.md`. A documented rule is not proof of a good design. However, distinguish challenging a contract from changing it: implement clear corrections under the current contract; report proposed changes to supported behavior, public capabilities, execution boundaries, Error/fatal classification, or other semantic architecture for my decision. Do not silently narrow support, weaken guarantees, or reinterpret failing tests to justify a preferred design.

## Establish scope and a reproducible baseline

Inspect the repository state, package entry points, commands, and test instructions. Record the baseline commit, existing staged/unstaged changes, environment, and baseline verification results. Include relevant uncommitted project work in the audited snapshot and preserve it. Do not reset, discard, commit, or publish unrelated work.

Keep evidence tied to identifiable source revisions. The fixed-snapshot rule in `project-audit.md` protects reproducibility; it does not prohibit the authorized fixes here. Use a controlled working tree or isolated checkout that includes the intended baseline, and identify tested revisions by commit plus patch or file hashes as needed. Do not mix evidence from concurrent edits. After a batch changes shared mechanisms, refresh the affected evidence and earlier reproductions against the new revision; do not restart unrelated finished investigations without a reason.

Use the project's actual verification commands. Diagnose baseline failures before attributing them to new work. A pre-existing failure is still within this audit's scope; a tool or environment failure is not evidence of a runtime defect.

## Build coverage independently of the existing map

Inventory all first-party production code, public APIs, supported operations, tests and test helpers, scripts, package/build/CI configuration, examples, and active documentation. Account for generated or vendored files explicitly and inspect their integration rather than auditing third-party source line by line. Distinguish current requirements from future plans and historical records.

Use `docs/coverage-tree.md` as a starting map, not a completeness certificate:

- Reconcile every current responsibility under C01-C15 with code, callers, tests, and the authoritative contract. Add responsibilities missing from the tree.
- Review S1-S8 as simplification hypotheses. Earlier kept or rejected alternatives are evidence about those particular designs, not proof that a branch is exhausted.
- Keep F01-F05 and other planned functionality separate. Evaluate their consistency and dependencies where relevant, but do not implement a future semantic cutover merely because it appears in a plan.
- Audit project surfaces outside the runtime tree, including package exports, supported environments, test discovery, and verification tooling.

Maintain a coverage ledger in `docs/audit-report.md`. Every first-party file must be accounted for individually or in an explicit, enumerated group; every executable module and public operation must map to a reviewed responsibility. Read each in-scope implementation completely, including low-risk helpers, and inspect its callers and consumers. Search hits, filenames, and test counts do not establish review coverage.

For each responsibility, record its files/routes, contracts, shared mechanisms, correctness review, design review, evidence, unresolved gaps, and next action. Distinguish **unvisited**, **in progress**, **reviewed with evidence**, and **blocked**; record reasoned, executed, and untested claims separately. Do not mark a whole branch reviewed because one representative test passed.

Rank deeper investigations by structural risk, but ensure every area receives an initial review before repeatedly deepening familiar areas. Prioritize confirmed severe defects as they arise. Keep the ledger and work queue current so context compaction or continuation does not lose scope or repeat completed work.

## Perform three complementary sweeps

### 1. Correctness, omissions, and composition

Apply the invariant matrix and state-trace method from the audit prompts. Trace creation, writers, capture/transfer, consumption, publication, and retirement. Inspect every relevant caller and bypass of shared fallible helpers, not just the helper itself.

Derive expected behavior from supported semantics and explicit all-ready sequential executions. Verify the sequential behavior independently before using it as a delivery oracle: ready and deferred execution can share the same bug. Compare values, effects, identity and topology, intermediate visibility, Error attribution, required completion, and progress.

Deliberately cover supported combinations of ready, synchronous-thenable, and deferred delivery; success and failure; observation and mutation; aliases and cycles; capture and later replacement; managed and external boundaries; entry, repair, and structural Array changes. Use short conflicting sequences and explicit schedule witnesses before broader seeded exploration. Do not replace targeted interaction coverage with an infeasible Cartesian product or large random-run totals.

Check work and retained memory independently of returned values: consumed-path bounds, history scaling on small graphs, last-use release, retirement, re-entry, unfinished siblings, and fatal shutdown. Required unresolved Promises may remain pending; distinguish a legitimate wait from a circular dependency or work withheld after all required dependencies finish.

Respect the documented support boundary. Investigate invalid application data, supported host/reflection failures, internal defects escaping valid operations, and isolation. Do not add a tamper-resistance framework or tests for deliberate corruption excluded by the contract.

### 2. Architecture, design, and code quality

Perform this sweep for every subsystem, including those without reproduced bugs. Identify the strongest existing patterns and why they work. Look for places where the same invariant could eliminate duplicated state, parallel paths, compensating flags, repeated traversals, adapters, or scattered cleanup.

Ask whether the current representation forces downstream reconstruction, whether facts live at the right scope, whether each abstraction earns its cost, and whether a focused redesign would remove several mechanisms. Examine dependency direction, coupling, confusing names, hidden side effects, dead code, stale comments, and inconsistent conventions where they obstruct understanding or correctness.

For each material simplification, name the current problem, the proposed invariant, the exact mechanisms removed and introduced, affected producers and consumers, a counterexample that would disprove it, and expected work/allocation effects. Preserve distinctions with genuinely different authority, ordering, failure, or lifetime requirements. Shared syntax alone does not justify a common engine.

Prefer improvements that remove causes over local patches that accumulate exceptions. A clear cross-module redesign is authorized; size alone is not a reason to defer it. Conversely, do not manufacture findings, mandate rewrites, introduce generic frameworks without need, or spend the audit on cosmetic churn. Evaluate net conceptual complexity rather than line count. Record elegant mechanisms worth retaining and the invariants that make apparent complexity necessary.

### 3. Tests, tooling, and documentation

Audit the evidence itself: discovery, skipped cases, swallowed failures, timeouts, nondeterminism, model independence, generator coverage, instrumentation sensitivity, and assertions coupled to interchangeable representations. Check whether diagnostic inspection changes the state or scheduling being tested; use uninstrumented or non-indexing controls where required.

Check current docs and examples against the actual public API and contracts. Correct unambiguous drift. Record substantive contradictions rather than choosing whichever wording makes the implementation pass. Planned fixes do not make current violations disappear, and unimplemented future features are not current omissions unless already required.

## Decide, fix, and verify

A finding has a clear solution when the defect or concrete maintainability problem is established, the intended behavior is unambiguous, the affected producers and consumers are understood, and the correction can be justified and verified without a new semantic decision. Implement those solutions without requesting routine approval. Do not defer a clear fix merely because it is difficult or touches many files.

For each confirmed defect, retain a minimal reproduction or conclusive transition/code proof. Add or extend an appropriate regression that fails before the correction and passes afterward when executable verification is applicable. Use the public supported route where possible. Add tests for supported semantics and load-bearing invariants; do not write tests merely to pin a rename, documentation edit, or internal layout.

Make coherent batches, remove superseded paths in the same batch, and recheck sibling routes and the whole failure family. Update affected documentation and coverage references. Do not weaken tests simply to obtain green results. Revert only your own unsuccessful experiments when they add complexity or fail to preserve the contract.

Run focused checks during investigation, then broader required checks after each coherent change to shared mechanisms. Reuse the models, conflict matrices, verifiers, and larger-scale settings in `test/README.md`; record commands, bounds, seeds, and outcomes. At the final revision, run the full suite and all applicable repository-required checks, plus affected larger-scale checks not already valid for that revision. Avoid repeatedly running unchanged checks without a reason.

When a solution remains unclear, continue enough investigation to make the finding actionable, record it, and move on. Ambiguity is not permission to guess; the existence of a possible redesign is not permission to defer an otherwise clear correction.

## Keep one actionable report

Create and maintain `docs/audit-report.md` throughout the work. If it already exists, preserve useful history and clearly identify the new audit and current status. Keep detailed evidence in tests or linked artifacts when that makes the report easier to use; this file must remain the single entry point for my review.

Put unresolved findings and decisions first, ordered by impact. Give each a stable ID and include:

- Classification and status: confirmed defect, specification/contract contradiction, design problem, verification gap, or unconfirmed hypothesis.
- Impact and affected supported behavior; exact code/contract references.
- Expected versus actual behavior, minimal reproduction/trace or concrete structural evidence, and confidence limits.
- Root cause and related routes or failure-family members.
- Recommended solution and meaningful alternatives, including tradeoffs and any semantic or migration impact.
- Why it remains unresolved, the specific decision or missing evidence, and the next useful step.

Also include a concise fixed-findings log with validation; the coverage ledger and remaining queue; baseline and tested revisions; verification results and limitations; and important strengths or necessary complexity worth preserving. Link existing findings rather than duplicating conflicting accounts in plans or `simplifications.md`. Update their status when this audit resolves them. Do not bury open decisions beneath a chronological work diary or report suspicions as proven bugs.

## Completion

Continue autonomously until all of the following are true:

1. The actual repository inventory and current supported functionality are reconciled with the coverage ledger. Every in-scope area has a correctness, design, and relevant test/documentation review, with explicit evidence and limitations.
2. The cross-cutting sweeps in `project-audit.md` are accounted for, and targeted high-risk interaction matrices and discovered failure families have been investigated. Any blocked obligation is explicitly identified, not silently counted as covered.
3. Every established finding with a clear contract-preserving solution has been implemented and verified. Every remaining issue is actionable in `docs/audit-report.md`; recording a readily fixable defect is not a substitute for fixing it.
4. Required checks have run against the final code revision. Failures are fixed where the solution is clear; remaining failures and unavailable checks are accurately classified and documented. Unrun checks never count as passes.
5. A final independent read of the resulting diff, affected callers, report, and coverage ledger finds no overlooked required work, displaced defects, unsupported claims, abandoned experiments, or unexplained coverage omissions.

Completion means the defined sweep and authorized repair work are finished, with explicit residual decisions and verification limits. It does not mean every possible bug has been disproved. An unresolved design decision can remain in the report without blocking unrelated completion; unvisited code or an unfinished clear fix cannot be relabeled as residual risk to end early.

Do not stop merely because tests pass, several findings were fixed, one slice ended, or context is running low. On interruption or a tool/budget limit, save the exact next actions and state that the audit is incomplete. Finish with a concise summary of changes, verification, coverage limits, and a link to the report and its most consequential open decisions.
