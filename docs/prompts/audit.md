# Systematic correctness and simplification audit

Use this prompt to audit a feature, phase, diff, subsystem, or architecture and the mechanisms it depends on. Supply the scope in the accompanying request. If no narrower scope is supplied, review the current changes and related code. Read the current implementation; do not assume the examples below remain defects.

Adapt the audit to the feature. Derive its invariants, lifecycle, relevant inputs, and failure boundaries before choosing tests. The runtime examples in this prompt are optional applications of the method, not requirements to audit unrelated functionality. Scale the investigation to the change and its risks; a small synchronous feature does not need a concurrency model or a new test framework.

## Goal

Find remaining correctness defects systematically, explain why they arise, and identify architectural simplifications that eliminate families of failures. Reduce total complexity: fewer concepts, fewer independent mechanisms, and fewer rules that callers must remember. Code reduction is useful evidence, but not sufficient evidence of simplification.

Do not stop at individual reproductions, nearby regression tests, a passing suite, or another broad review finding nothing. Establish coverage of the invariants and transitions that the implementation must preserve. Include older code using the same mechanisms, not just the current diff.

Consult [AGENTS.md](../../AGENTS.md), relevant architecture documents, the implementation plan, and the feature's authoritative contracts. For data and external-code boundaries in this repository, consult [data limitations](../data-limitations.md). Distinguish semantic contracts from implementation choices. Follow the user's current decisions when documentation is stale. Treat established requirements and principles as open to reasoned revision, subject to the discussion process below.

## Procedure

1. Set the scope and read the applicable contracts and support boundary.
2. Enumerate relevant operation routes and data categories; map their rules, enforcement, and coverage in one invariant matrix.
3. Choose independent expectations and extend existing tests or exploration helpers where they provide reusable coverage.
4. Exercise short sequences, relevant event orders, and supported failures within explicit bounds.
5. Reduce failures, identify their underlying families, and trace sibling producers and consumers of the affected state.
6. Evaluate structural simplifications and discuss requirement changes where they could improve the design.
7. Report findings, evidence, clean coverage, remaining gaps, and decisions needed.

Scale each step to the scope. A focused audit can use a few table rows and tests; it does not require a new model, generator, or framework. Retain useful coverage in the normal test suite, not a growing collection of audit-specific scripts.

## Look for recurring failure families

| Family | Examples to investigate | Underlying question |
| --- | --- | --- |
| Incomplete state transfer | Payload survives but presence, version, provenance, recovery information, or side effects do not | What complete semantic state must cross this boundary? |
| Confused ownership or responsibility | A failure updates two owners; a component applies an effect belonging to its container | Are authority, access coordination, publication, failure handling, and cleanup being treated as interchangeable? |
| Decisions based on incomplete information | Lazy discovery changes classification; traversal order changes validation | Does the available evidence establish the fact being inferred? Can later discovery invalidate an earlier decision? |
| Inconsistent enforcement across routes | One API validates a rule while an equivalent path bypasses it | Where else is this same semantic rule required, and which routes bypass its enforcement? |
| Incorrect completion or lifetime | Success is exposed before required effects finish; resources are released too early or retained too long | Which distinct completion and last-access points does the contract require? |

For every confirmed issue, audit the full invariant it violates. Search for every constructor, writer, transfer, default, and consumer of the affected record or fact, including indirect helper calls. Check the same assumption in other operations, data categories, representations, and timing paths. For example, a presence-transfer defect calls for checking every placement producer and consumer, not just other deletion functions. Strengthen a family of tests rather than adding only the reported example.

Check simple, synchronous cases as carefully as deferred or concurrent ones. A failure that occurs without concurrency is not explained by asynchronous complexity.

## Diagnose causes before choosing fixes

Evaluate whether each problem comes from:

- Necessary complexity imposed by the feature's contracts, such as ordering, ownership, atomicity, compatibility, recovery, or external effects.
- A representation that omits information and forces downstream code to reconstruct it with flags or special cases.
- Duplicated enforcement or parallel execution paths that have drifted apart.
- Requirements changed in one place but retained elsewhere in code, tests, or documentation.
- Tests covering features independently without establishing that they compose correctly.
- Unsupported misuse accidentally treated as a requirement.

Keep facts at their natural scope and derive them where possible. Persist a fact only when it cannot be correctly reconstructed or repeated derivation has a demonstrated material cost. Do not collapse distinct facts into one field merely to reduce the number of fields.

Preserve load-bearing distinctions. Reversible state changes and irreversible external effects may need different handling; source processing and consumer-specific validation may have different owners; final state may not encode earlier observable effects. Universal rules do not require a universal execution engine.

Use the actual support and trust boundary. Exercise invalid application inputs, supported external failures, isolation, resource lifetimes, and internal defects reached through valid operations. Do not add defenses or tests for behavior explicitly excluded by that boundary. Conversely, do not dismiss adversarial input when the feature is required to enforce a security boundary. In this runtime, trusted compiler records and deliberate corruption of runtime interfaces follow the exclusions in AGENTS.md.

## Discuss requirements that obstruct a better design

Actively ask whether a requirement, capability, compatibility promise, exception, or foundational principle causes disproportionate complexity. Consider simpler semantics, narrower supported behavior, removal of little-used flexibility, and more general rules. Do not assume a requirement is necessary merely because it is documented or already implemented.

When changing a requirement could enable a materially simpler architecture, cleaner implementation, or more reliable behavior, bring that possibility to the user for discussion. Explain:

- The current requirement and the user need it serves.
- The complexity or correctness risk it causes, with concrete examples or code paths.
- The smallest useful change, including behavior lost or changed and any migration impact.
- Which mechanisms disappear or become shared, which contracts remain intact, and the expected costs and benefits.
- Your recommendation, alternatives, and any uncertainty that a bounded experiment could resolve.

Discuss the tradeoff before adopting a semantic change unless the user has already authorized it. Do not repeatedly seek approval for an agreed decision, and do not require approval for routine implementation choices that preserve the contract. Continue independent investigation under the current contract while a required decision is pending.

If the current requirement remains important and no simpler sound implementation is apparent, say so. Present the unresolved design problem rather than accumulating local workarounds or claiming a speculative abstraction is an improvement. Do not weaken a contract merely to make failing tests pass.

Once a change is agreed, update the relevant architecture, plan, and tests to describe the final behavior. Remove superseded contradictory requirements; do not leave implementers to reconstruct decisions from review history.

## Build an invariant matrix

First enumerate the relevant public entry points and internal boundary routes, then the supported target categories or execution modes. For each semantic rule, account for every applicable route/category combination: name its enforcement point and coverage, explain why it does not apply, or mark a gap. Do not treat an empty cell as evidence of coverage. Include equivalent paths that delegate to different helpers and internal producers that bypass public validation.

Capture that inventory in one compact working matrix; split a row only where enforcement or semantics differ:

| Invariant | Authoritative contract | Routes and categories | Enforcement points | Tests and independent oracle | Gaps or unresolved decisions |
| --- | --- | --- | --- | --- | --- |

Use the implementation plan and test references for durable guidance. Avoid a separate sprawling review history. Reconcile documentation disagreements before choosing an oracle, and inspect relevant existing test assertions against that contract. A passing regression can preserve obsolete behavior. Explain any corrected expectation from the authoritative contract; never change it solely to accommodate the implementation.

Select applicable invariants from the feature's contract, including:

- Correct outputs, side effects, ordering, and intermediate observations.
- Isolation, authority, immutability, and protection of caller-owned inputs.
- Complete state transfer, including absence, identity, version, and provenance where meaningful.
- Atomicity, publication, recovery, and preservation of earlier successful effects.
- Error classification, ownership, completeness, and attribution.
- Resource acquisition, release, cancellation, and termination rules where supported.
- Consistency across supported APIs, representations, and execution modes.
- Work and memory bounds, including retained history and pending work.

For a Cascada runtime audit, apply the relevant concrete invariants in the final section of this prompt. Do not import those semantics into unrelated features.

## Verify short operation sequences

Prefer integration tests through the feature's public interface. Extend existing behavioral-equivalence tests and independent consistency checks rather than immediately introducing a new testing framework.

When adding tests, retain confirmed reproductions as regressions and keep reusable sequence runners, generators, or checkers alongside the existing tests. In this repository, use `test/` and the normal `npm test` suite for bounded routine coverage. A later audit should extend that coverage. Larger optional exploration may use a separate reproducible command; state its bounds and cost. Disposable probes are useful during investigation, but preserve their valuable coverage before removing them. A review-only task reports reproductions and proposed tests without assuming authorization to fix production code.

Start with small sequences whose expectations can be stated independently:

```text
capture → mutate → observe the earlier capture
enter → assign → delete → leave
fail → inspect → repair → mutate
borrow result → resolve source → mutate source
child operation → parent operation → sibling operation
successful mutation → failed mutation → repair
pending publication → later replacement → earlier consumer resumes
start pending work → copy or change related state → resume earlier work
```

At resumption, establish which captured owner, version, or snapshot the continuation may still update. Exercise intervening sibling writes, replacement, repair, or release where applicable. Where ordered publication is required, check that earlier completion cannot overwrite later state or acquire a later conflicting operation as a new prerequisite. Preserving a captured value and retaining authority to publish it are distinct obligations.

Choose complementary oracles suited to the feature:

- A trusted standard or reference implementation for behavior that is meant to match it. Account explicitly for documented differences. Native JavaScript is useful for Cascada property and Array behavior, including presence, holes, length, and conversion effects.
- A small reference model specifying observable behavior without reproducing the implementation's internal mechanisms. A sequential model can cover state changes, failure, and recovery.
- Equivalent-program checks: compare different operation sequences under explicit preconditions and identify which outputs, effects, and ordering must agree. Direct assignment and entry-then-assignment may have equivalent completed state without identical intermediate availability. Ready/pending execution is another instance. Test intentional differences separately; similar-looking operations are not automatically equivalent.
- An event-order checker for concurrent work, using the contract's dependency and conflict rules.
- Independent consistency checks for maintained indexes, relationships, bindings, or resource ownership where public behavior alone cannot expose the invariant. Run them after relevant transitions, including failure and recovery, not only at the final state. Check in-flight state only against invariants that apply there.

Use native JavaScript only for semantics intended to match it. Runtime-specific poison, rollback, authority, and ordering need separate expectations; a full shadow runtime is not a prerequisite. Where rollback is promised, compare the repaired logical value with the baseline at the failed operation's ordered turn, preserve earlier successful effects, and check other owners remain unchanged. Do not apply rollback equality to irreversible external effects.

Comparing two routes through the same implementation cannot detect a bug shared by both. Combine equivalence checks with independent expectations. For a new oracle or substantial extension, demonstrate that it rejects representative incorrect outcomes or event traces. Deliberately changing production code in an isolated copy is an optional additional sensitivity check, not a mandatory mutation-testing framework.

## Vary representations and timing deliberately

Choose relevant dimensions rather than blindly applying this list. Consider empty and populated inputs, boundary sizes, absent and present state, alternative representations, operation order, fresh and reused state, failures, and lifecycle transitions. For asynchronous graph/runtime features, useful concrete dimensions include:

- Ready values, synchronous thenable fulfillment or rejection, deferred Promise fulfillment or rejection, and inputs that never settle.
- Direct access, entered access, nested entry, and an inner entry outliving an outer callback.
- Private, shared, leased, imported, and retained values.
- Records, ordinary Arrays, ArrayViews, holes, absent properties, and explicit undefined values.
- Root, intermediate, and final placements; in-range and out-of-range indexes.
- Managed data, observation-only external data, registered external scopes, and mixed connecting branches.
- Fresh and already-admitted result data, lazy descendants, aliases encountered in different orders, and small cycles.
- Healthy state, ordinary Error data, scope poison with recovery, and permanent binding conflict.
- Independent settlement orders and issuance before earlier results settle.

Do not take the full Cartesian product blindly. Cover meaningful pairs and the higher-order combinations implicated by failures. State which combinations were exercised, excluded by contract, or left untested, following the support boundary above.

For generated exploration, use a reproducible generator and record seeds plus distinct command/schedule traces. Repeated runs or different seeds do not prove different coverage. Vary issuance between individual microtask turns after source settlement as well as before settlement and after complete draining; source readiness and queued publication may occur in different turns. Include several independently pending inputs with different settlement orders, not only many commands waiting on one source. Capture observations before a later mutation and verify their earlier state even when delivery occurs after that mutation; also verify protection after delivery.

Compare specified values and effects, not interchangeable implementation representations. Test determinism only where promised. For Cascada, compare Error membership, kind, cause, and source attribution where required; do not require deterministic Error ordering or wrapper identity where the contract permits differences. Preserve the narrowly documented invalid-input detection exceptions without extending them to successful data or effect ordering.

## Trace state lifetimes

For every state or resource an operation creates, identify its owner, progress dependencies, and last-access point. For asynchronous work, distinguish issuance, publication, value availability, result delivery, and resource release wherever their lifetimes differ. State what each event proves and which later work it permits. An API return may acknowledge issuance without proving publication; tests must observe the event their assertion requires.

Test recovery for repairable failures and release at the correct last-access point. Permanent conflicts and terminal failures need not have a public repair transition; work waiting on an unresolved input need not finish. State which retained resources remain necessary and which unrelated work must still proceed.

Use never-settling inputs to check that completed or unrelated work does not retain their gates, reservations, or resources unnecessarily. Assert positive progress of independent work and the required ordering of dependent work, using explicit completion signals rather than arbitrary sleeps. No audit should manufacture a cancellation or forced-settlement requirement absent from the contract.

When a failure could starve the event loop or allocate without bound, use a subprocess with time and memory limits: an in-process timeout cannot interrupt a microtask livelock. Check progress after each independent input settles while other inputs remain pending, not only after all inputs settle.

Repeat operations that leave little or no final state, then check that retained bookkeeping is bounded by live data and unfinished dependencies, not historical operation count. Include no-op and create/remove cycles where relevant. Repeat with captured readers or queued writers still active to detect premature cleanup as well as leaks. Prefer deterministic bookkeeping checks to heap-size or garbage-collection timing assertions; avoid pinning an interchangeable representation.

## Inspect transitions and inject supported failures

Check relevant intermediate observations and host effects, not only final exported data. A final snapshot can hide an illegal temporary mutation, an observation seeing a later value, or premature resource release. Account for the checks themselves: a lookup or export can admit lazy data, establish sharing, or wait for it. Include schedules without those extra operations so the harness does not accidentally protect unretained children or serialize all work.

Identify the feature's actual stages, such as validation, selection, acquisition, preparation, execution, conversion, publication, cleanup, and recovery. Exercise supported failures at each fallible stage. For each case establish:

- Which result fails and which state or failure owner, if any, changes.
- Which original value and recovery state remain available.
- Which other owners and retained outputs remain unchanged.
- Which errors are independently required and must survive reporting or collection.
- Which work must wait, may proceed, or must stop.
- When acquired resources and operation-owned state cease to be needed.

Where complete collection is required, combine a failing inspection with independently discoverable errors before and after that item. Verify the required error membership, not merely that the operation reports some failure. A single injected exception can confirm classification while missing lost sibling errors. Identify how candidate enumeration and per-item inspection fail, including eager helpers that combine those stages.

Derive failure injection from the actual contract of each fallible action. Do not assume every external exception is fatal or every caught exception is recoverable. Test the promised termination, cleanup, and resumption behavior rather than assuming all work must be cancelled. In Cascada, fatal execution does not require settling or cancelling internal waits.

For host-interaction code, use these concrete techniques where applicable:

- Inventory calls that can execute host code or fail through reflection. Search for `Reflect.*`, descriptor and prototype operations, coercions, thenability probes, and reads or writes on native values; follow helpers and implicit language operations too. Classify each action by its boundary contract and required failure effect. Search results alone are not a complete inventory.
- Record supported Proxy traps, getters, coercions, and `then` access in a host-action log. Check required order and forbidden calls, such as consuming unused input, inspecting excluded items, or probing an intermediate value where the contract forbids it. Test that exclusions apply before the prohibited host action. Do not pin incidental call counts unless they are observable guarantees.
- Start each run from fresh equivalent input and throw at the k-th supported fallible host action within a bounded scenario. Log the action and trace, check its prescribed recoverable or fatal outcome, and run the applicable consistency checks. Keep injected behavior inside the storage and stability contract; a refused write must not secretly mutate storage. Failure paths can expose new actions, so extend those traces deliberately and report the sites covered rather than claiming the sweep finds every reflection defect.

## Bound exploration and reduce failures

Begin with the smallest state space that exercises the feature's invariants. For graph features, examples include a shared child, one cycle, a sparse Array, or a parent with two children. Explore short command sequences and small valid event-order combinations exhaustively where practical, then supplement them with reproducible seeded generation.

Record the bounds and seeds. Reduce each failure to a minimal sequence and topology. Retain useful regression coverage and remove disposable probes that no longer help. Expand exploration when a new failure exposes a missing dimension, rather than repeatedly running the same successful checks.

## Evaluate structural simplifications

Prioritize mechanisms that would eliminate a failure family over local repairs:

1. **Representation and invariants.** Could a different data model make invalid states impossible or remove several flags, compensating steps, or reconstruction paths?
2. **Unification.** Can paths implementing the same transition use one mechanism? Distinguish real behavioral differences from historical drift.
3. **Centralization.** Can a rule be enforced once at the boundary all relevant operations cross? Prefer clearer function boundaries over a new class unless the class removes real complexity.
4. **Dead weight.** Can adapters, obsolete state, deferred cleanup, configuration choices, or premature extension points be deleted without losing required behavior?
5. **Load-bearing complexity.** Which apparent special cases preserve a real invariant? State what would replace their protection before removing them.

Consider a focused rewrite when incremental fixes preserve the wrong structure. These are evaluation targets, not mandated rewrites. A generic framework or policy-driven walker may cost more than a small explicit case.

For every proposed simplification, identify the mechanisms it removes, the mechanisms it introduces, the invariants it centralizes, and its work/allocation costs. If implementation experiments are requested, compare before and after and revert experiments that merely move complexity, add indirect paths, or weaken required behavior.

When fixes are included, recheck the affected state producers and consumers after each correction. Beyond the original reproduction, exercise the interacting invariants the change could disturb: earlier captures, later publication, queued work, recovery, and cleanup as applicable. Update the coverage matrix with that evidence. Removing retained state must preserve outstanding publication authority; unifying completion signals must preserve distinct progress guarantees. A newly failing test or consistency check requires explanation against the contract, not automatic relaxation of its assertion.

Use the requirements discussion process above when an otherwise promising simplification changes supported behavior. Do not stop investigating solely because the current requirement rules it out.

## Report evidence and completion criteria

Report confirmed bugs separately from unproven concerns and simplification candidates. For each confirmed issue, provide a minimal reproduction or precise failing transition, the violated invariant, the affected routes, and the simplest coherent correction. State whether it belongs in the current work or a named future phase, and preserve important implementation guidance in the plan when updates are requested.

Explain why the defects occurred and whether the fixes eliminate a class of failures or protect one case. State any unresolved semantic decisions requiring user input with enough context to evaluate the tradeoff.

Include these deliverables, scaled to the scope and combined where clearer:

- The route and invariant coverage matrix, with gaps and exclusions.
- Reproducible commands, exploration bounds, and seeds where generation was used.
- Confirmed findings and regression-test references; identify proposed or unretained tests explicitly.
- What was checked without finding defects, including intermediate behavior and independent checks.
- Simplification recommendations, open decisions, and work deliberately deferred.

Keep durable coverage in tests and unresolved implementation work in the plan. Keep current code-specific suspicions out of this reusable prompt.

An audit can reach diminishing returns when:

- Every identified transition and supported failure boundary has an explicit contract and appropriate coverage.
- Bounded sequence and settlement-order exploration is clean within stated limits.
- Independent behavioral and consistency oracles agree.
- No unresolved ownership, publication, or completion rules remain in the audited scope.
- New findings are no longer revealing entire untested dimensions or recurring invariant violations.

State remaining gaps and confidence limits. Passing these criteria supports confidence in the documented model; it is not proof that all bugs have been found.

## Cascada runtime applications

Use these examples when they are relevant to the audit. They supplement the general method and do not establish that a particular implementation is currently defective.

Concrete invariant families include:

- Sequential equivalence, including intermediate observations and host effects; owner isolation, immutable retained outputs, and imported-data protection.
- Complete placement capture and transfer: presence, value, source version, and recovery baseline; Array length and holes; structural failure ownership and preservation of earlier successful effects.
- Fixed external locations and source-static authority; exactly one owner for each scope failure; original poison propagation and correct repair.
- Complete required Error membership and causal attribution, without an execution-wide recoverable-error history.
- Managed gate and lease lifetimes; external ancestor, descendant, sibling, and entry ordering; publication completion versus independent result availability.
- Admission atomicity, borrowed-result isolation, independence from alias traversal order, fatal execution behavior, and bounded retention of pending work.

For route coverage, consider lookup and expression extraction, export, Error queries, assignment, deletion, observational and mutating calls, repair, entry, and ordinary and method-result import. Cross applicable rules with managed data, observation-only external data, registered external scopes, and mixed connecting branches. Internal routes belong in this inventory without becoming supported public APIs.

Apply equivalence checks only within their contract. For example, index append and `push` can agree on successful Array contents while returning different values and selecting different mutation scopes. An Array-wide bang cannot cover registered mutable resources even when an ordinary index append is permitted. External repair clears repairable poison without rolling back completed native effects.

Reuse existing native-equivalence helpers and refcount verification. Where needed, independently check external poison summaries against their owners and children, dependency frontiers after relevant work settles, and lease acquisition/release balance. Do not require all frontiers or leases to be empty while work that legitimately needs them remains pending.
