# Phase 6 selection experiments

Retained evidence for the common guard/capture path. The [Phase 6 plan](runtime-evolution-plan.md#phase-6-support-promise-valued-path-segments) selects ordinary placement gates, versioned external metadata and the existing native reservation kernel with immediate completion of finished reads. The unused selection-dependency prototype is superseded; removing its files and default-suite tests is the first Phase 6 implementation step.

## Managed-only reservation removal

The external review's managed-only reservation removal is useful existing evidence, not another untested hypothesis. Its saved run reports 5,468 passing tests with one Promise-shape assertion failure, 9,600 external sequence programs and all four conflict-matrix partitions. Re-running its isolated external-path suite against the saved patch reproduces 199 passes and that one `failure instanceof Promise` assertion. A separate in-memory test substitution removes only that assertion and passes all 200 tests, including the remaining effect/publication assertions. Reconcile the assertion with the operation's completion contract when landing the simplification; the production source is not changed by these probes. The per-selection predecessor proposal is rejected by the quadratic-history result below.

## Withdrawn mixed-entry progress claim

The later review withdraws its probe E as a progress defect. A computed mixed entry at P can repair descendant api metadata, and its managed gate also orders a later api call's namespace capture. That call may therefore legitimately wait for the entry. This history does not justify narrowing the entry's fixed coverage or adding another dependency representation. Managed gates, metadata versions and native reservations can constrain the same operation while protecting different state and last-use boundaries; apparent overlap alone does not prove redundant machinery. Keep the Phase 6 public-operation checkpoint for actual handoff, lifetime and work bounds.

## Accepted read-completion simplification

Reads remove no predecessor frontier entries, so a finished read can complete immediately after its own required host access and effect work finish; any remaining work uses already captured state. Later conflicting work retains each earlier dependency directly or through a replacing mutation; mutation/exclusive completion still waits. The candidate scratch copy was checked against all 43 production source files and differed only in ExternalEffect's retained mode and read-completion branch. An independent 32-case check covered global and entry views, waiters issued before and after release, original and replaced predecessors, overlapping ancestors/descendants, sibling progress and entry completion. The unmodified kernel unnecessarily held the unrelated sibling; the candidate released it while preserving true conflicts. These checks establish the local reservation rule, not full Phase 6 path/metadata integration. Port those cases to the production suites when implementing the rule.

## Superseded selection-dependency prototype

Capturing predecessors separately per unresolved selection creates quadratic history: 1,024 selections retained 523,776 links even when all later selected no external work.

The grouped/indexed/shared-wait follow-up is not part of the selected architecture. [Phase 6 cleanup](runtime-evolution-plan.md#0-remove-superseded-prototype-artifacts) removes its five files and default-suite coverage before production implementation begins; removal remains planned work, with no maintained alternative kernel or benchmark suite left behind.
