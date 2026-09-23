# Systematic correctness and simplification audit

Use this prompt to audit an implementation, a plan or architecture before implementation, or a combination of them, including the mechanisms they depend on. Supply the scope in the accompanying request. If no narrower scope is supplied, review the current changes and their relevant contracts, plans, and code. Establish what exists and what is proposed; do not assume the examples below remain defects.

Adapt the audit to the feature and its maturity. Derive its invariants, lifecycle, relevant inputs, and failure boundaries before choosing traces, models, or tests. The runtime examples in this prompt are optional applications of the method, not requirements to audit unrelated functionality. Scale the investigation to the change and its risks; a small synchronous feature does not need a concurrency model or a new test framework.

## Goal

Find remaining correctness defects systematically, explain why they arise, and identify architectural simplifications that eliminate families of failures. Reduce total complexity: fewer concepts, fewer independent mechanisms, and fewer rules that callers must remember. Code reduction is useful evidence, but not sufficient evidence of simplification.

Do not stop at individual reproductions, nearby regression tests, a passing suite, or another broad review finding nothing. Establish how each relevant invariant survives the transitions under review. Include existing users of shared mechanisms and planned interactions, not just the changed text or code.

Consult [AGENTS.md](../../AGENTS.md), relevant architecture documents, the implementation plan, and the feature's authoritative contracts. For data and external-code boundaries in this repository, consult [data limitations](../data-limitations.md). Distinguish semantic contracts from implementation choices. Follow the user's current decisions when documentation is stale. Treat established requirements and principles as open to reasoned revision, subject to the discussion process below.

## Choose the audit mode

State the mode and scope briefly, then apply the shared procedure below:

| Mode | Investigation and evidence |
| --- | --- |
| Implementation | Read the actual code and related callers. Trace enforcement, run relevant tests, and reproduce suspected failures through supported routes. Check conformance to the applicable phase's required end state. |
| Plan/architecture | Trace proposed state transitions and search for contradictions, counterexamples, missing information, and unsupported assumptions. Inspect existing code where the proposal relies on its behavior. Use small models or bounded experiments when useful; an unimplemented feature does not require a production implementation to audit its design. |
| Mixed | Mark each mechanism as implemented, proposed, or transitional. Compare the intended end state with both the actual behavior and the steps planned to reach it. Keep evidence for each distinct. |

For a plan or architecture audit:

- Map every architectural behavior, invariant, failure/recovery rule, and deliverable to a mechanism and a verification method. Where a plan exists, require an implementation step or phase for each; for architecture alone, identify implementation obligations without inventing a phase schedule. An unspecified helper name is not an implementation path: establish what information and authority it has and how it preserves the invariant.
- Separate settled requirements from implementation choices and experiments. Each material experiment needs a question, bounded scope, success criteria, and a fallback or decision point; its hoped-for result is not an established fact.
- Check dependencies and intermediate states wherever staged delivery is proposed. A phase cannot rely on a prerequisite delivered later. Identify changes that must land together, independent work, and removal of superseded paths, tests, APIs, or documentation. Justify deferrals against the current phase's contract.
- Do not report an existing defect as a new plan omission when the plan already fixes it completely. Check that its fix covers sibling routes and interacting invariants. Distinguish an intentional current/future difference from contradictory end-state requirements.

Instructions below about tests and failure injection apply directly to existing code. Before implementation, apply their reasoning to specified transitions, independent expected outcomes, and supported failure scenarios; record proposed tests as proposed. Do not write tests that merely assert plan wording or build speculative production machinery to make an audit possible. A review alone does not authorize fixes; make edits when the task requests them.

## Procedure

1. Set the scope, mode, and audited snapshot, and read the applicable contracts and support boundary.
2. Build the invariant matrix and trace critical state before choosing scenarios: creation/defaults → writers → capture/transfer → consumers → retirement. Include authoritative ownership, publication authority, and indirect routes.
3. Choose independent expectations and evidence. Identify how the test harness or proposed observations could change execution; include the paired runs required below where inspection affects state or timing.
4. Deliberately exercise short conflicting sequences before broader exploration. Cover relevant event orders and supported failures; retain a witness for each targeted interaction instead of assuming a generator reached it.
5. Check results and ordering, retained state, and computation separately. A passing result or bounded subscription count does not establish bounded work.
6. Reduce failures, identify their underlying families, and evaluate structural simplifications. Discuss requirement changes where they could improve the design.
7. If fixes are authorized, recheck the affected state traces, consumers, and verification cases after each correction. Update the matrix; check whether solving one problem introduced another.
8. Report findings and evidence by matrix row, including unresolved gaps, exclusions, and decisions needed. Limit confidence to the mechanisms and interactions actually checked.

Treat these steps as checkpoints: record evidence, a remaining gap, or why a check does not apply. Scale the record to the scope; a focused audit can use a few rows and worked transitions without a new framework. Before implementation, trace proposed transitions and work bounds, use worked counterexamples, and mark implementation-dependent claims as unverified. Retain executable coverage in the normal test suite and unresolved obligations in the plan.

Pin the audited snapshot, such as a commit or exported index, so concurrent edits cannot mix evidence from different versions, and report it with the results. In a repeated audit, first re-run earlier reproductions and retained probes against it. Report each as fixed, still present, or superseded, and correct earlier claims that new evidence contradicts.

## Build an invariant matrix

First enumerate the relevant public entry points and internal boundary routes, then the supported target categories or execution modes. For each semantic rule, account for every applicable route/category combination: name its existing or proposed enforcement and verification, explain why it does not apply, or mark a gap. Do not treat an empty cell as evidence of coverage. Include equivalent paths that delegate to different helpers and internal producers that bypass public validation. Compare every caller of a shared fallible helper as well: guards, captured inputs, and failure effects can differ around each call.

Capture that inventory in one compact working matrix; split a row only where enforcement or semantics differ:

| Invariant | Authoritative contract | Routes and categories | State trace, enforcement, and implementation step/phase | Evidence/status and verification | Gaps or unresolved decisions |
| --- | --- | --- | --- | --- | --- |

For each changed or high-risk state fact, record its creation and defaults, every writer, capture/transfer route, consumer, and retirement point. Name the authoritative owner and who may still publish after a copy, replacement, handoff, or closure. Include side records, indirect helper calls, and routes that bypass common helpers. Attach compact traces to the relevant rows; one trace may serve several invariants. Before implementation, identify these responsibilities in the proposed transitions and mark unspecified handoffs as gaps.

Mark evidence as executed (with result), reasoned, proposed/untested, or excluded by a named contract. Untraced routes remain gaps. Identify claims lacking execution evidence explicitly; passing tests through one helper do not cover every caller or bypass. For a proposal, keep its transition argument separate from the future verification obligation. Use code/test references or worked transitions to substantiate each row. Reconcile documentation disagreements before choosing an oracle: a passing regression can preserve obsolete behavior. Explain corrected expectations from the authoritative contract, never solely from implementation behavior.

Select applicable invariants from the feature's contract, including:

- Correct outputs, side effects, ordering, and intermediate observations.
- Isolation, authority, immutability, and protection of caller-owned inputs.
- Complete semantic state transfer, including destination rules, authority, absence, identity, version, and provenance where meaningful.
- Atomicity, publication, recovery, and preservation of earlier successful effects.
- Error classification, ownership, completeness, and attribution.
- Resource acquisition, release, cancellation, and termination rules where supported.
- Consistency across supported APIs, representations, and execution modes.
- Work and memory bounds, including retained history and pending work.

For a Cascada runtime audit, apply the relevant concrete invariants in the final section of this prompt. Do not import those semantics into unrelated features.

## Look for recurring failure families

| Family | Examples to investigate | Underlying question |
| --- | --- | --- |
| Incomplete state transfer | Payload survives but logical destination rules, presence, version, authority, provenance, recovery information, or side effects do not | What complete semantic state must cross this boundary? |
| Confused ownership or responsibility | A failure updates two owners; a component applies an effect belonging to its container | Are authority, access coordination, publication, failure handling, and cleanup being treated as interchangeable? |
| Decisions based on incomplete information | Lazy discovery changes classification; traversal order changes validation | Does the available evidence establish the fact being inferred? Can later discovery invalidate an earlier decision? |
| Inconsistent enforcement across routes | One API validates a rule while an equivalent path bypasses it | Where else is this same semantic rule required, and which routes bypass its enforcement? |
| Incorrect completion or lifetime | Success is exposed before required effects finish; resources are released too early or retained too long | Which distinct completion and last-access points does the contract require? |

Use these families to challenge the initial state traces, before a failure is known. When an issue is confirmed, revisit the whole affected invariant across sibling operations, categories, representations, and timing paths. A presence-transfer defect, for example, calls for rechecking every placement producer and consumer. Extend the family's verification beyond the reported example.

Check simple, synchronous cases as carefully as deferred or concurrent ones. A failure that occurs without concurrency is not explained by asynchronous complexity.

## Diagnose causes before choosing fixes

Evaluate whether each problem comes from:

- Necessary complexity imposed by the feature's contracts, such as ordering, ownership, atomicity, compatibility, recovery, or external effects.
- A representation that omits information and forces downstream code to reconstruct it with flags or special cases.
- Duplicated enforcement or parallel execution paths that have drifted apart.
- Requirements or representation authority changed in one place but retained elsewhere in code, tests, or documentation, including consumers that still decide from a representation that is no longer authoritative.
- Tests covering features independently without establishing that they compose correctly.
- Unsupported misuse accidentally treated as a requirement.

Keep facts at their natural scope and derive them where possible. Persist a fact only when it cannot be correctly reconstructed or repeated derivation has a demonstrated material cost. Do not collapse distinct facts into one field merely to reduce the number of fields.

For copying, rebasing, wrapping, lowering, or another representation change, verify preservation of the operation's meaning as well as its payload. Logical destination constraints, authority, causal context, and recovery responsibilities must survive wherever they remain relevant. A private storage location or temporary representation must not silently become the semantic target. Identify the common boundary that can enforce this without adding per-route exceptions.

Preserve load-bearing distinctions. Reversible state changes and irreversible external effects may need different handling; source processing and consumer-specific validation may have different owners; final state may not encode earlier observable effects. Universal rules do not require a universal execution engine.

Use the actual support and trust boundary. Exercise invalid application inputs, supported external failures, isolation, resource lifetimes, and internal defects reached through valid operations. Do not add defenses or tests for behavior explicitly excluded by that boundary. Conversely, do not dismiss adversarial input when the feature is required to enforce a security boundary. In this runtime, trusted compiler records and deliberate corruption of runtime interfaces follow the exclusions in AGENTS.md.

A candidate patch in an isolated copy can test a diagnosis even when fixes are not authorized. Re-run every reproduction and the independent oracles against it: reproductions that survive reveal an additional cause, and new failures reveal a displaced problem. Instrumenting the writers of the suspected fact in that copy shows the actual write sequence. Report such patches as experiments, not fixes.

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

## Verify short operation sequences

For an implemented feature, prefer integration tests through its public interface and extend existing behavioral-equivalence tests and independent consistency checks. For a proposal, walk the same sequences against its transition rules and record the expected intermediate and final states. Use an executable model only where it improves the evidence; do not reproduce a missing implementation inside a new test framework.

When adding tests, retain confirmed reproductions as regressions and keep reusable sequence runners, generators, or checkers alongside the existing tests. In this repository, use `test/` and the normal `npm test` suite for bounded routine coverage; [test/README.md](../../test/README.md) describes the existing generated sequences, conflict matrix, verifiers, and scaling settings. A later audit should extend that coverage. Larger optional exploration may use a separate reproducible command; state its bounds and cost. Disposable probes are useful during investigation, but preserve their valuable coverage or report their reproductions and proposed tests before removing them.

Start with small sequences whose expectations can be stated independently. Where operations overlap or defer publication, deliberately hold a predecessor pending and queue two or more conflicting operations on the same logical target. Include failure followed by replacement or repair, and a predecessor that makes no change, where supported. Cover overlapping parent/child targets and independent siblings where their rules differ. A direct operation, an operation inside an entered scope, and several operations queued behind that scope can use different paths; establish their equivalence where promised. These targeted cases precede random exploration.

Other useful sequences include:

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
- Equivalent-program checks: compare different operation sequences under explicit preconditions and identify which outputs, effects, and ordering must agree. Include failure ownership, attribution, and recovery, not only successful values or Error kinds. Direct assignment and entry-then-assignment may have equivalent completed state without identical intermediate availability. Ready/pending execution is another instance. Test intentional differences separately; similar-looking operations are not automatically equivalent.
- An event-order checker for concurrent work, using the contract's dependency and conflict rules.
- Independent consistency checks for maintained indexes, relationships, bindings, or resource ownership where public behavior alone cannot expose the invariant. Run them after relevant transitions, including failure and recovery, not only at the final state. Check in-flight state only against invariants that apply there.
- The pre-change baseline for behavior the change should leave unaffected. Run the same programs on both versions and explain every difference as intended or a defect.

Use native JavaScript only for semantics intended to match it. Runtime-specific poison, rollback, authority, and ordering need separate expectations; a full shadow runtime is not a prerequisite. Where rollback is promised, compare the repaired logical value with the baseline at the failed operation's ordered turn, preserve earlier successful effects, and check other owners remain unchanged. Do not apply rollback equality to irreversible external effects.

Comparing two routes through the same implementation cannot detect a bug shared by both. Combine equivalence checks with independent expectations. For a new oracle or substantial extension, demonstrate that it rejects representative incorrect outcomes or event traces. Deliberately changing production code in an isolated copy is optional.

Check the harness before relying on its evidence. Inspection may establish sharing or leases, admit lazy data, install dependencies, flush work, or wait for settlement. For affected sequences, use fresh equivalent inputs for paired runs: one with intermediate observations and one with only final observation. Do not await each command in the latter merely to assert its result. Compare the outcomes the contract requires to agree, and separately assert any intended differences in timing or ownership. Before implementation, account for these effects in the worked traces and verification plan; an unspecified observer effect is an open obligation.

A harness can also produce wrong evidence without changing execution. Issue each observation synchronously at its program position and keep its result; an observation issued from a continuation, or after awaiting another result, observes a later position. Settle to quiescence, including inputs that callbacks create during settlement, before reporting a hang. Classify each run's outcome locally: global handlers must not absorb harness crashes, and a missing or empty report is a harness failure, not a clean result.

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

For generated exploration, record seeds and actual command/schedule traces. For each targeted interaction in the matrix, retain a concrete executed trace or a coverage assertion showing it occurred; a generator's available commands and large seed counts are insufficient. No new coverage framework is required. Vary issuance between individual microtask turns after source settlement as well as before settlement and after complete draining; source readiness and queued publication may occur in different turns. Include several independently pending inputs with different settlement orders. Capture observations before a later mutation and verify their earlier state on and after delivery, alongside the runs without intermediate observations required above.

Compare specified values and effects, not interchangeable implementation representations. Test determinism only where promised. For Cascada, compare Error membership, kind, cause, and source attribution where required; do not require deterministic Error ordering or wrapper identity where the contract permits differences. Preserve the narrowly documented invalid-input detection exceptions without extending them to successful data or effect ordering.

## Trace state lifetimes

For every state or resource an operation creates, identify its owner, progress dependencies, and last-access point. For asynchronous work, distinguish issuance, publication, value availability, result delivery, and resource release wherever their lifetimes differ. State what each event proves and which later work it permits. An API return may acknowledge issuance without proving publication; tests must observe the event their assertion requires.

Check two proof obligations explicitly:

- **Completion:** before declaring success, exposing committed effects, or releasing recovery state, can unfinished validation or publication still invalidate the operation? Preserve responsibility, causal context, and publication authority through required work and any handoffs. Distinguish it from pending data or independent work that the contract permits to outlive completion; do not solve the problem by waiting for everything.
- **Retirement:** before removing metadata, overlays, retained state, or redundant copies, does the remaining representation expose the same logical state and preserve every live capture and publication obligation? Completion alone does not prove that fallback storage is current. Necessary current state is not historical garbage.

Test recovery for repairable failures and release at the correct last-access point. Permanent conflicts and terminal failures need not have a public repair transition; work waiting on an unresolved input need not finish. State which retained resources remain necessary and which unrelated work must still proceed.

Use never-settling inputs to check that completed or unrelated work does not retain their gates, reservations, or resources unnecessarily. Assert positive progress of independent work and the required ordering of dependent work, using explicit completion signals rather than arbitrary sleeps. No audit should manufacture a cancellation or forced-settlement requirement absent from the contract.

When a failure could starve the event loop or allocate without bound, use a subprocess with time and memory limits: an in-process timeout cannot interrupt a microtask livelock. Check progress after each independent input settles while other inputs remain pending, not only after all inputs settle.

Repeat operations that leave little or no final state, then check that retained bookkeeping is bounded by live data and unfinished dependencies, not historical operation count. Include no-op and create/remove cycles where relevant. Repeat with captured readers or queued writers still active, and with copies or forks of the affected state made while its dependencies remain pending, to detect premature cleanup as well as leaks. Prefer deterministic bookkeeping checks to heap-size or garbage-collection timing assertions; avoid pinning an interchangeable representation.

Check computation independently of retention. For mechanisms that repeatedly update or traverse maintained state, derive work per transition in terms of explicit inputs, produced output, and affected dependencies. Challenge rescans of unaffected state. Include the workloads the change exists to improve, and count representation churn, such as copies, materializations, identity changes, and forks per operation, alongside traversal steps: a correct result can hide a copy on every operation. Where scaling is a risk, count meaningful operations at several bounded input sizes and vary completion order, active/inactive consumers, and registration/removal patterns. Prefer counts to timing thresholds; legitimate dependency work need not be linear in input size. For proposals, record the cost argument and the experiment needed to verify it. A leak fix that trades retained history for repeated recomputation must satisfy both bounds.

## Inspect transitions and inject supported failures

Check intermediate observations and host effects as well as final state, using the paired harness runs above. A final snapshot can hide an illegal temporary mutation, an observation seeing a later value, or premature resource release.

Identify the feature's existing or proposed stages, such as validation, selection, acquisition, preparation, execution, conversion, publication, cleanup, and recovery. Exercise or trace supported failures at each fallible stage. For each case establish:

- Which result fails and which state or failure owner, if any, changes.
- Which original value and recovery state remain available.
- Which other owners and retained outputs remain unchanged.
- Which errors are independently required and must survive reporting or collection.
- Which work must wait, may proceed, or must stop.
- When acquired resources and operation-owned state cease to be needed.

Where complete collection is required, combine a failing inspection with independently discoverable errors before and after that item. Verify the required error membership, not merely that the operation reports some failure. A single injected exception can confirm classification while missing lost sibling errors. Identify how candidate enumeration and per-item inspection fail, including eager helpers that combine those stages.

Derive failure injection from the actual contract of each fallible action. Do not assume every external exception is fatal or every caught exception is recoverable. Test the promised termination, cleanup, and resumption behavior rather than assuming all work must be cancelled. In Cascada, fatal execution does not require settling or cancelling internal waits.

For host-interaction code, use these concrete techniques where applicable:

- Inventory calls that can execute host code or fail through reflection. Search for `Reflect.*`, descriptor and prototype operations, coercions, thenability probes, and reads or writes on native values; follow helpers and implicit language operations too. Classify each action by its boundary contract and required failure effect. Search results alone are not a complete inventory. A repeated read of the same host fact within one operation is a separate fallible action that may observe a different value; prefer deriving the fact once from its guarded capture.
- Record supported Proxy traps, getters, coercions, and `then` access in a host-action log. Check required order and forbidden calls, such as consuming unused input, inspecting excluded items, or probing an intermediate value where the contract forbids it. Test that exclusions apply before the prohibited host action. Do not pin incidental call counts unless they are observable guarantees.
- Start each run from fresh equivalent input and throw at the k-th supported fallible host action within a bounded scenario, counting only actions in the phase under test; a failure injected during setup changes the scenario rather than testing it. Log the action and trace, check its prescribed recoverable or fatal outcome, and run the applicable consistency checks. Keep injected behavior inside the storage and stability contract; a refused write must not secretly mutate storage. Failure paths can expose new actions, so extend those traces deliberately and report the sites covered rather than claiming the sweep finds every reflection defect.

## Bound exploration and reduce failures

Begin with the smallest state space exercising the targeted interactions: for graph features, a shared child, one cycle, a sparse Array, or two siblings may suffice. Explore short sequences and valid event orders exhaustively where practical, then supplement them with seeded generation. Record bounds, reduce failures to minimal sequences and topologies, retain useful regressions, and remove disposable probes. Expand exploration when a failure exposes a missing dimension. Sample subsets across every dimension; a prefix of a nested enumeration covers only its outer dimensions. When reducing, remove steps from the oracle as well as the program, and reduce against the specific failure signature rather than any failure.

Validate the generator's coverage too. Reuse a well-mixed seeded generator; taking small moduli of a simple linear congruential generator can correlate supposedly independent choices. Record the semantic combinations actually exercised, including relevant pairs of input shape, outcome, operation route, and readiness. Assert coverage of important combinations instead of trusting a large run count. Pairwise coverage is not proof of sequence coverage: retain explicit multi-step regressions for discovered triggers, and vary each step's readiness independently, including ready work queued behind pending work. A better generator does not replace these witnesses or the oracle's sensitivity checks.

## Evaluate structural simplifications

Prioritize mechanisms that would eliminate a failure family over local repairs:

1. **Representation and invariants.** Could a different data model make invalid states impossible or remove several flags, compensating steps, or reconstruction paths?
2. **Unification.** Can paths implementing the same transition use one mechanism? Distinguish real behavioral differences from historical drift.
3. **Centralization.** Can a rule be enforced once at the boundary all relevant operations cross? Prefer clearer function boundaries over a new class unless the class removes real complexity.
4. **Dead weight.** Can adapters, obsolete state, deferred cleanup, configuration choices, or premature extension points be deleted without losing required behavior?
5. **Load-bearing complexity.** Which apparent special cases preserve a real invariant? State what would replace their protection before removing them.

Consider a focused rewrite when incremental fixes preserve the wrong structure. These are evaluation targets, not mandated rewrites. A generic framework or policy-driven walker may cost more than a small explicit case.

For every proposed simplification, identify the mechanisms it removes, the mechanisms it introduces, the invariants it centralizes, and its work/allocation costs. If implementation experiments are requested, compare before and after and revert experiments that merely move complexity, add indirect paths, or weaken required behavior.

After each authorized correction, repeat the applicable checkpoints for the changed state trace and affected consumers. Recheck earlier captures, later publication, queued work, recovery, cleanup, and work bounds. Prior evidence applies only while its assumptions still hold. Check for displaced problems: removing retention can add recomputation or lose publication authority; combining completion signals can erase distinct progress guarantees. Update the matrix. Explain newly failing tests against the contract; do not automatically relax their assertions.

Use the requirements discussion process above when an otherwise promising simplification changes supported behavior. Do not stop investigating solely because the current requirement rules it out.

## Report evidence and completion criteria

Distinguish implementation defects, design counterexamples or contradictions, missing specifications/proof obligations, and unmeasured simplification candidates. For each finding, state its impact and evidence: a reproduction, a precise code or transition argument, an incompatible pair of requirements, or the information that is missing. Name the violated invariant, affected routes, and simplest coherent correction. For a change, classify each finding against the pre-change baseline as a regression, pre-existing, or improved, by re-running its reproduction or measurement there. State whether it belongs in the current work or a named future phase, and whether it blocks a dependent step. Preserve important implementation guidance in the plan when updates are requested.

Do not present a conjectured failure as reproduced or an implementation detail as a semantic contradiction. Future behavior is not a current implementation defect unless already required in the audited scope; conversely, a planned fix does not make a required but missing behavior conformant. A model may validate a formula without validating scheduling, reclamation, or integration; state exactly which claim each experiment establishes. A passing current suite is not evidence that a proposed mechanism works.

Explain why the defects occurred and whether the fixes eliminate a class of failures or protect one case. State any unresolved semantic decisions requiring user input with enough context to evaluate the tradeoff.

Include these deliverables, scaled to the scope and combined where clearer:

- The route and invariant matrix, with critical state traces, evidence status, gaps, and exclusions.
- Reproducible commands, exploration bounds, seeds, and witnesses for targeted interactions; identify harness variants and retention/work measurements where applicable.
- Findings with code/contract references and supporting traces, models, or regression tests; identify proposed or unretained tests explicitly.
- What was checked without finding defects, including intermediate behavior and independent checks, and what remains only specified or untested.
- Simplification recommendations, open decisions, and work deliberately deferred.

Keep durable coverage in tests and unresolved implementation work in the plan. Keep current code-specific suspicions out of this reusable prompt.

Across modes, confidence increases when:

- Every identified transition and supported failure boundary has an explicit contract and enforcement path, and each requirement has appropriate evidence or a clearly identified verification obligation.
- Independent expectations agree with the checked transitions; bounded exploration, where performed, is clean within its stated limits.
- No unresolved ownership, publication, completion, or requirement contradiction is hidden behind an unspecified helper or assumed experiment result.
- New findings are no longer revealing entire untested dimensions or recurring invariant violations.

For implementation, additionally require executable coverage and applicable behavioral/consistency checks against the actual code. For architecture, require coherent mechanisms and verification obligations; where a plan exists, require complete requirement-to-step-to-verification mapping and sound dependencies. Distinguish readiness to implement settled work from readiness to integrate a mechanism awaiting experimental proof. Bounded implementation experiments may remain; material semantic decisions and unassigned proof obligations must not masquerade as completed design.

Before describing the audit as clean or complete, reconcile every important matrix row with its evidence and disclose unresolved tracing, execution, or measurement gaps. Limit a clean result to the checked scope; suite size and generated-run totals cannot substitute for missing interaction coverage. For architecture, reasoned obligations and proposed tests remain distinct from implementation assurance. State readiness conditions and confidence limits; these criteria help judge diminishing returns without claiming that all bugs have been found.

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

Reuse the native-equivalence helpers, generated sequences, conflict matrix, and consistency verifiers that [test/README.md](../../test/README.md) describes, and extend them where the audited feature adds operations or states. Where needed, independently check external poison summaries against their owners and children, dependency frontiers after relevant work settles, and lease acquisition/release balance. Do not require all frontiers or leases to be empty while work that legitimately needs them remains pending.
