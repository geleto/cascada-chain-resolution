# Whole-project audit

Use this prompt to audit the complete runtime: every supported feature, the shared mechanisms beneath them, and their interactions. It organizes the work. [audit.md](audit.md) remains the method for auditing each area, and the [feature review prompt](../feature-review-prompt.md) the method for reviewing a feature's design from first principles; read both first. Supply any narrower priorities, exclusions, or budget in the accompanying request.

A whole-project audit differs from a change audit in three ways. No change anchors it, so risk must be ranked explicitly. Many defects arise where features compose, so sweeps must cross feature boundaries. The audit is too large for one pass, so it proceeds in slices whose evidence stays tied to one snapshot.

## Pin the snapshot

Audit a fixed snapshot: a commit, or the staged index exported with `git checkout-index -a --prefix=<dir>/`. Copy or link the dependencies into that directory to run the suite there. Other agents may edit the working tree during the audit, so take no evidence from it. Record the snapshot identifier with every result. When the snapshot changes, re-run earlier reproductions, targeted matrices, and retained explorers against it before continuing, and report each finding as fixed, still present, or superseded.

A review does not authorize fixes. Diagnostic patches belong in isolated copies of the snapshot and are reported as experiments.

## Build the project map

Derive the map from the authoritative contracts ([AGENTS.md](../../AGENTS.md), [data limitations](../data-limitations.md), and the architecture documents), the source modules, the tests, and the implementation plan. Record for each area:

- its public operations, internal routes, and supported categories;
- the shared mechanisms it depends on, and the state it creates, persists, or retires;
- its contracts, known deferrals, and documented exclusions;
- its executable evidence: integration tests, native-equivalence checks, seeded sequence models, consistency verifiers, and earlier audit results.

Then map each shared mechanism to every feature that uses it. Audit a mechanism once as a mechanism, and again at each composition point where a feature changes its inputs or states.

Reconcile documentation with the implementation while mapping. Contracts, plans, tests, and code that disagree are a finding even before any failure is reproduced.

## Rank areas by risk

Rank by structural risk, not by size or apparent importance. Raise priority for:

- **Persisted derived facts.** Flags, counters, summaries, frontiers, positions, captured shapes, and similar facts stored instead of derived. Every writer of the data a fact describes must update or invalidate it, including writers added by later work.
- **Secondary representations.** Physical storage beneath logical overlays, shared backing beneath views, staged state beneath committed state, retained baselines beneath visible poison, and captured values beneath live ones. Every read must be valid for the authoritative state, and every write must hold authority.
- **Extended state spaces.** Mechanisms whose states later work extended. Older consumers may never have been checked against the new states.
- **Ordering across several signals.** Work ordered by more than one pending dependency, queue, or reservation, especially with nested scopes and repair.
- **Host boundaries.** Reflection, Proxies, getters, thenables, coercion, and external calls.
- **Thin evidence.** Areas covered only by hand-written examples, without a model, native oracle, exhaustive small matrix, or consistency verifier.

Lower-ranked areas still need their contracts checked: pure synchronous helpers, dispatch tables, and error factories usually need reading and focused tests rather than exploration. State the ranking and its reasons before starting, and revise it when findings reveal a new risk family.

## Trace cross-cutting state within each slice

Use the project map to locate these risk families across the source, then complete the relevant state traces before exploring each ranked slice. Follow shared mechanisms across feature boundaries, but do not require exhaustive project-wide sweeps before testing a high-risk hypothesis. Maintain one inventory of checked, suspicious, and unvisited sites so later slices cover the remaining source.

1. **Fact writers.** Enumerate every persisted derived fact by searching field writes and metadata records. For each, list its source data and every writer of that data, direct or through helpers, and check that each writer updates or invalidates the fact. Check creation defaults, copies, forks, and handoffs: a fact copied at installation or transfer can describe a source that later changes independently.
2. **Representation authority.** Enumerate every read and write of a secondary representation. A read is valid only where no authoritative overlay can cover it, or after proving that the representation matches the authoritative state. A write is valid only under the authority that owns that state; a write through a detached, superseded, or captured handle is a defect even when later work usually masks it.
3. **New-state consumers.** For each state introduced by later work, such as a new overlay, pending presence, or partial knowledge, list every consumer of the affected representation, including older code, and check that each handles the state.
4. **Equivalent routes.** For each semantic rule, list the routes that must enforce it and compare their guards, captured inputs, and failure effects, as [audit.md](audit.md) describes.
5. **Host actions.** Build the project-wide inventory of actions that can run host code or fail through reflection, and classify each against its boundary contract.

Record each sweep as a table of sites with a verdict and evidence. Confirm defects with an executable reproduction or a conclusive code or transition proof. State any missing executable verification; distinguish a proved contradiction from a suspicion that still needs investigation. A reproduction is preferred for timing-dependent behavior, not a prerequisite for reporting an architectural contradiction.

## Explore behavior with executable oracles

Then audit the ranked areas with the procedure in [audit.md](audit.md). At project scale:

- Reuse and extend the tooling [test/README.md](../../test/README.md) describes: the seeded sequence models, the conflict matrix, the native-equivalence helpers, and the consistency verifiers. Add an independent verifier for any persisted fact or secondary representation that public behavior can mask.
- In instrumented runs, check after commands and relevant settlement turns, not only at the end; a masked inconsistency may surface only through a later operation. Also run bounded controls without initial indexing or intermediate verifiers: those inspections can consume lazy data or change dependencies. Keep observations required by the scenario distinct from optional diagnostic reads.
- Enumerate short conflicting sequences exhaustively before random generation. Include a predecessor held pending, two or more queued commands on one target, a command that changes nothing, and removal or repair after creation.
- Validate generator quality and combination coverage as [audit.md](audit.md) describes; `createRandom` in the native-equivalence helpers is a suitable seeded generator.
- Compose features deliberately. Combine each high-risk area with entry, pending data, failure and repair, structural Array changes, copies, and external scopes wherever they are supported together.
- Compare untouched features against the last audited baseline, and explain every difference as intended or a defect.
- Scale runs across parallel processes with time and memory limits. Record seeds, commands, bounds, and cost.

Treat exploration as evidence only after checking the harness, as [audit.md](audit.md) requires. After correcting a harness defect, re-run every exploration it affected and correct earlier claims.

## Work in slices

Audit one ranked area or one sweep per slice. Each slice reports its scope, snapshot, evidence, findings, and remaining gaps. Carry the project-wide state between slices: the map, the ranking, the sweep tables, the retained explorers, and the open findings. End a slice when its targeted matrices and sweep rows are complete and further exploration stops revealing untested dimensions; record what remains.

When a finding is confirmed, search the project for the same fact, representation, or ordering pattern, then prioritize its affected sites in the remaining slices. Validate adjacent uses of the same mechanism in the current slice; record other sites as open obligations rather than indefinitely expanding that slice. A family found in one feature is a strong predictor of defects elsewhere.

Coordinate with concurrent fixes. When a fix is staged, re-run its reproductions and the affected explorers, and check neighboring areas for displaced problems.

## Retain the tooling

Move explorers, matrices, and verifiers that prove useful into `test/`, following the retention rules in [audit.md](audit.md). Keep default runs bounded in `npm test` and scale larger runs through environment settings. Depend on implementation internals only where a verifier must inspect maintained state. Document each tool, its settings, and how to extend it in [test/README.md](../../test/README.md).

## Report

Maintain one project-level report alongside the slice reports. Include:

- the snapshot history, and the status of every finding on the current snapshot;
- the project map, with the strength of evidence per area: reasoned, targeted tests, exhaustive matrices, generated exploration, or verifiers;
- the sweep tables and their unresolved sites;
- findings grouped into families, with impact, affected areas, classification against the baseline, and the structural correction that would remove each family;
- retained tooling and how to run it;
- residual risk: areas and combinations not yet checked, and the evidence that would raise confidence.

Order findings by impact: silent wrong values or effects and corrupted maintained state first, then unexpected fatal failures and hangs, then progress, work, and retention bounds, then diagnostics and documentation. Do not call the project clean. Report where evidence is strong, where it is thin, and which families stopped yielding findings under the stated coverage.
