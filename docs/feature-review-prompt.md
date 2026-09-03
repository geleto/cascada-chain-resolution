# Feature Review Prompt

Perform a first-principles review of **[FEATURE]** using **[RELEVANT PLAN, ARCHITECTURE, CONTRACT, AND IMPLEMENTATION FILES]**. Review the intended end state, not just the current prose or code. If the feature is not implemented, evaluate whether the design is complete and implementable. If it is implemented, also verify the code and tests.

Do not treat any document, including `AGENTS.md`, as infallible. Treat the user's stated semantics as authoritative, use existing contracts and mechanisms where they remain logically sound, and flag any principle, plan, architecture, test, or implementation that conflicts with the required behavior. Existing code is evidence of available mechanisms, not proof that its behavior or structure should be preserved.

The goal is to find omissions, contradictions, races, authority leaks, lifetime errors, and unnecessary complexity before implementation. Do not stop after finding the first plausible design. Work systematically until every relevant state, boundary, timing, and interaction has an explicit answer.

## 1. Establish the feature contract

- Read every relevant plan, architecture, contract, limitation, API, implementation, and test file completely.
- Inspect current diffs when they contain decisions not yet reflected everywhere. Distinguish staged, unstaged, and existing behavior; do not mistake a future requirement for current functionality.
- Reconstruct the feature's observable semantics in plain language: inputs, outputs, state changes, ordering, failures, authority, and lifetime.
- Define every recurring term before relying on it. Detect different names for the same concept and one name used for different concepts.
- Build a requirement ledger mapping each requirement to its defining document, implementation point, and verification. Identify requirements that were lost, duplicated, weakened, moved into the wrong phase, or contradicted elsewhere.
- Separate fixed semantics from implementation choices. Question implementation choices; do not "solve" contradictions by silently changing semantics.

## 2. Model the complete operation lifecycle

For every operation introduced or affected by the feature, trace this full timeline:

1. The operation is issued.
2. Inputs, paths, identities, and scopes are captured.
3. Ordering dependencies and protection are registered.
4. Ready work runs synchronously.
5. Required pending values settle and continuations resume.
6. Validation, selection, boundary processing, and user or host code run.
7. State and bookkeeping changes are published atomically.
8. Results and failures cross their boundaries.
9. Gates, phases, leases, borrows, reservations, and other temporary authority are released.

At each point ask:

- What facts are known now, and which become known only later?
- What must be registered synchronously before any wait?
- What may another already-issued or later operation observe or mutate?
- Which captured version or identity is authoritative after replacement, deletion, COW, Promise settlement, or repair?
- Can failure leave partially committed state, bookkeeping, authority, or protection?
- Does ready execution behave identically to Promise-backed execution except for timing?
- Does a direct Promise extend the operation? Can a nested Promise incorrectly extend it or escape its lifetime?

Do not accept phrases such as "before the call," "after resolution," "the current value," "the same path," or "protected state" without identifying the exact program point, version, identity, path, and protection mechanism.

## 3. Audit facts at their correct scope

Classify every persisted or derived fact by its natural scope:

- identity;
- occurrence or placement;
- property version or mirror;
- path and path prefix;
- Chain;
- operation;
- context or execution;
- process/global state.

For each fact ask:

- Is it stored at the narrowest correct scope?
- Can aliases require different occurrence facts for one identity?
- Can two Chains use the same path text but require different facts?
- Can replacement or COW make stored path or identity information stale?
- Is a fact being persisted even though it can be derived safely at use time?
- Is one store incorrectly serving as both classification and authority, or is the same fact duplicated in multiple stores that can drift?

## 4. Exercise the semantic matrix

Check every meaningful combination, not only representative happy paths:

- ready and pending inputs, receivers, path segments, and results;
- observation and mutation;
- managed and external state, including mixed graphs;
- record, Array, managed class, external class, Function, Error, Promise, primitive, and unsupported value;
- root, nested property, absent property, own data property, inherited property, accessor, non-enumerable property, and Symbol property where relevant;
- unique, shared, leased, indexed, gated, and phase-protected state;
- aliases, cycles, repeated identities, and the same identity reached through different paths or Chains;
- ready and Promise-valued path segments;
- synchronous return, direct Promise, nested Promise, throw, rejection, validation Error, poison, repair, and fatal failure;
- assignment, replacement, deletion, lookup retention, import, export, host retention, and COW publication;
- operation issued before, during, and after another observation, mutation, failure, or repair;
- async branches, loops, and child operation buffers when the feature can interact with them.

For combinations claimed to be impossible, identify and verify the rule that makes them impossible. Do not use an undocumented assumption as a proof.

## 5. Prove concurrency and ordering

Construct adversarial event traces for overlapping operations. At minimum test:

- observation then observation;
- observation then mutation;
- mutation then observation;
- mutation then mutation;
- operations on overlapping ancestor and descendant scopes;
- the same identity through aliases, different paths, or different Chains;
- a replacement or deletion while earlier work is pending;
- failure or repair while peers and successors are already issued;
- two operations that each wait for data protected by the other.

For every trace state:

- what is registered at issuance;
- what each operation waits for;
- what may run concurrently;
- what exact state each operation reads or changes;
- when publication occurs;
- when protection and authority end;
- why no race, deadlock, self-wait, stale read, lost update, or authority leak is possible.

Verify that ordering uses the correct mechanism:

- phases order operations;
- leases preserve managed values without blocking mutation;
- gates publish unfinished managed transitions;
- mirrors preserve captured Promise-backed property versions;
- COW preserves other managed owners;
- external guards and borrows order exact host state;
- import and export enforce the host boundary.

Flag any mechanism used merely because it is convenient when another existing mechanism expresses the invariant directly.

Apply copy semantics before reasoning from JavaScript identity:

- Every new logical occurrence of managed data is an independent value. Mutation through one occurrence cannot change another, regardless of runtime representation or when physical copying occurs.
- Every occurrence of external data denotes the same exact host identity and therefore requires authority and ordering rather than copy semantics.

Reject any failure trace or proposed mechanism that treats two managed logical values as shared mutable JavaScript references.

## 6. Audit boundaries, authority, and ownership

Identify every point where data or control crosses between Cascada and host JavaScript. For each crossing specify:

- whether the value is imported, exported, retained unchanged, or consumed internally;
- which identities are copied and which remain exact;
- who may observe, mutate, retain, or return them;
- whether Errors are preserved, combined, consumed, rejected, or fatal;
- whether Promises extend the operation and who owns their completion work;
- when source protection ends;
- whether result processing and publication finish before the operation is considered complete.

Check that authority cannot be acquired accidentally through aliasing, lookup, return, assignment, import, export, copying, or a later graph change. Check that imported managed storage is never mutated and that external mutation occurs only under explicit, correctly scoped authority.

## 7. Audit graph and bookkeeping transitions

For every graph change, examine logical placements rather than only textual paths or physical JavaScript properties.

- Preserve aliases and cycles where required.
- Distinguish identity inspection from occurrence/path reporting.
- Verify COW reconnects the correct occurrences and does not silently relocate authoritative state.
- Verify mirrors, refcount indexes, ownership, sharing, admission, origin, path indexes, and other bookkeeping are updated through the ordinary transition or by one atomic equivalent.
- Compute multi-identity or multi-placement changes before committing them. A traversal-order failure must not leave partial authority or partial bookkeeping.
- Check transitions caused indirectly by parent replacement, alias severing, child insertion, Promise settlement, repair, and child-buffer publication, not only direct writes to the target.
- When an optimization skips a walk, copy, index update, or allocation, name the invariant that makes the skipped work unnecessary and verify where that invariant is established and maintained.

## 8. Review failure semantics

For every possible failure, classify the exact boundary that failed:

- language Error or poison;
- Promise rejection;
- supported user/host-code failure;
- validation failure;
- representation limitation requiring materialization;
- violated internal contract or host behavior that makes runtime invariants untrustworthy and is therefore fatal.

Verify that:

- no Error is lost when several inputs or descendants fail;
- required preparation continues only where needed to collect defined failures;
- user or host code is not invoked after preparation prevents it;
- an observational failure does not mutate state or poison mutation scope unless explicitly specified;
- mutation poison is published in operation order;
- repair has precise authority and ordering and cannot clear unrelated or later failure;
- ready and asynchronous failures have the same logical effect;
- cleanup runs on every non-fatal exit, while cleanup failure is not silently swallowed.

## 9. Seek structural simplification

After correctness is established, perform a separate simplification pass in this order:

1. **Structural wins:** replace several mechanisms with one stronger invariant, data model, or transition.
2. **Unification:** merge paths that perform the same state change; preserve separate paths only for load-bearing semantic differences.
3. **Centralization:** put classification, validation, boundary processing, ordering, or lifecycle logic at its natural single entry point.
4. **Delete dead weight:** remove adapters, compatibility paths, flags, caches, strategies, or future flexibility with no demonstrated use.
5. **Protect load-bearing complexity:** explicitly name code or rules that look removable but preserve a real invariant.

Prefer reusing existing primitives over adding a new scheduler, graph model, authority store, importer/exporter, continuation path, or cleanup framework. However, do not force two mechanisms together merely because their APIs look alike; their invariants must be the same.

Evaluate every proposed simplification after applying it conceptually or in code:

- Did it reduce concepts, branches, state, or code that a maintainer must understand?
- Did it merely move or rename complexity?
- Did it add hidden coupling or weaken a contract?
- Would a fresh rewrite of the affected module be smaller and clearer than incremental adaptation?

Reject or revert a "simplification" whose net result is not simpler.

## 10. Verify implementation and tests

When implementation exists:

- Trace each requirement to actual code; do not infer completeness from passing tests.
- Search for parallel implementations, stale helpers, transitional scaffolding, and old terminology.
- Inspect callers and consumers, not only the new module.
- Check that helper names reveal whether they prepare receivers, arguments, boundaries, results, or lifecycle state.
- Prefer integration tests that exercise public behavior and real scheduling. Add focused unit tests only for isolated invariants that integration tests cannot diagnose clearly.
- Include adversarial tests derived from the lifecycle, semantic matrix, and concurrency traces above.
- Run the complete relevant suite, static checks, bookkeeping/oracle checks, and diff checks.

When implementation does not yet exist:

- Verify every required primitive already exists or is explicitly included in the correct phase.
- Identify prerequisites without pulling future behavior into earlier phases.
- Ensure phase boundaries leave a coherent, testable end state and do not require temporary architecture that the next phase immediately replaces.

## 11. Reconcile the documents after the review

- Put each rule in one authoritative document at the right abstraction level.
- Keep reusable principles in `AGENTS.md`; keep feature semantics and architecture in feature documents; keep implementation order and verification in the plan; keep user obligations in limitation documents.
- Elsewhere, reference the authoritative rule instead of restating it incompletely.
- Remove superseded proposals and historical discussion unless they document current behavior that exists nowhere else.
- Compare the final text with the original and current diff to ensure no requirement, prohibition, edge case, rationale for a load-bearing rule, or verification item was lost.

## Required output

Lead with the conclusion. Then report findings in severity order. For each finding include:

- the violated or missing invariant;
- a minimal concrete example or event trace;
- the exact documents, code, or tests affected;
- whether the defect is semantic, architectural, implementation, documentation, or test-only;
- the simplest correct fix and why it is sufficient;
- whether to fix it now, move it to a named phase, or request a user decision.

Separate:

- correctness blockers and race conditions;
- omissions and contradictions;
- architectural simplifications;
- documentation drift;
- missing verification;
- load-bearing complexity that must remain.

Do not manufacture findings to fill categories. If no unresolved issue remains, say so and summarize the invariants and adversarial cases that were verified. If intent is genuinely ambiguous, do not guess: state the smallest precise decision needed and explain the consequences of each viable choice.

If asked to fix the findings, first complete the audit so fixes share one coherent model. Apply the clear fixes, re-run the full review against the edited result, compare it with the original for lost information, and leave unrelated or user-owned changes untouched. Do not stage changes unless explicitly requested.
