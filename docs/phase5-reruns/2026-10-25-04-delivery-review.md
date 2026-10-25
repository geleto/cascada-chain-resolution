# Focused delivery semantics review, run 04

Reviewer: `/root/missed_delivery_semantics`, a separate agent using the inherited model (exact version unavailable). Scope: shared captured delivery across pending presence, failed entry publication and copied recovery. This review made no production or normal-suite changes. No additional supported semantic defect was found in the routes below; the exclusions remain unreviewed by this subtask.

The execution-input digest before and after the final probe runs was `57f37a8ce537797856fcbae1346f27e3b43fec8f5d4ae58f413fe6876e52f88e` on Node v24.14.1. [Evidence](2026-10-25-04-delivery-evidence.json) retains exact commands, environments, outputs, probe hashes and actual runtime-execution receipts for normal and traced runs. The separate probes are outside that execution-input manifest and have their own hashes.

## Questions derived from the contracts

The property-version and handoff contracts require copying the captured presence, value, recovery and unfinished producer without transferring destination authority. An absent entered placement must remain absent when copied; a present `undefined` must remain present. An out-of-range write can grow Array length even if subsequent repair restores a hole. Copies made before a later replacement must preserve the earlier gate's outcome. Releasing a copied owner must not revoke an already captured export or Error query. Repair and replacement need the preceding transition, but need not consume the pending value they overwrite.

Those obligations led to the following source traces, before adopting the earlier review's conclusions:

- `mutations.shallowCopyPathContainer` enumerates candidates, reserves record order for pending presence, calls `copyPlacement`, and transfers container structure. `copyPlacement` retains a distinct destination version while sharing only the source delivery; `createVersionFromPlacement` carries pending presence, transition and recovery.
- `createCopyDelivery` waits for the captured producer through `resolvePlacement`/`continueCapturedPromiseVersion`; it does not treat source notification as completed publication. `refreshCopiedDelivery` publishes through each version's own destination. A retired destination has no storage authority, while an independent capture remains a delivery use.
- `activateRelationships` refreshes completed inactive versions before installing their outgoing edges. `retireRelationships` clears active destination authority. The new probes prove retirement of the discarded copy, rather than inferring it from root clearing.
- `resolvePlacementTransition` lets replacement wait only for preceding publication. Repair transfers the preserved baseline; copied recovery and the original poison keep their separate uses. Later source replacement must not rewrite either captured outcome.

## New executable coverage

| Route/invariant | New evidence | Result and limit |
| --- | --- | --- |
| Copy pending presence, record insertion order, hole versus present undefined | [Presence probe](2026-10-25-04-delivery-presence.mjs): record, in-bounds hole and out-of-range Array index; initially absent/present; deletion, undefined, object and failed-prefix repair; indexed/plain; held/discarded copy | 384 cases passed, comprising 96 all-ready synchronous controls and 288 deferred cases. Normal and traced repetitions are the same scenarios. |
| Retired copy with independent export and Error query | Same probe; the copy is forced apart from the live source before capture and root clearing | All 192 discard cases assert `relationshipsActive === false` before gate completion (144 with a still-pending gate). Both consumers preserve the captured value; a later source replacement is excluded. Raw lookup values are used only to inspect retirement metadata, never as retained managed input. |
| Copied gate publishes poison with two still-pending recovery children; queued repair and overwrite | [Recovery probe](2026-10-25-04-delivery-recovery.mjs): three prerequisites, six settlement orders, child fulfillment/rejection, indexed/plain; independent original recovery after copy repair | 76 cases passed: 72 deferred cases and four all-ready synchronous controls. Captured export and original owner report the same scope poison and context. Copy repair/overwrite leaves the original recovery value or rejection unchanged. |
| Completion without unused recovery dependencies | Same recovery probe, entry gate delivered first while both child inputs remain unresolved | 24 cases prove both repair and replacement complete before either payload is delivered. `setImmediate` drains already queued bridges; it does not release either required test signal. |
| Delivery protocol differences | Both probes use a pre-settled ordered source as all-ready control, native Promises, ordered thenables returning native chains, and ordered thenables returning custom chains | The explicit expected values, presence, length, key order, Error identity/context and owner isolation agree across these modes. Refcount verification and no-fatal assertions run in every case. |

All four final jobs passed. The traced jobs each emitted an actual `executed` receipt. Counts above are **460 distinct cases**, run both normal and traced; earlier development runs are not added to the total. The all-ready expectations are stated directly in each script rather than copied from a runtime-produced baseline. The retained source owner and the copied owner receive different marker writes to ensure actual COW, and the original recovery is inspected separately after the copy has changed.

## Boundaries and remaining gaps

These probes add pending-presence and pending-poison/recovery combinations absent from the previous 648/60/80-case review scripts. They do not replace those scripts, the broader generated acceptance gates, or a full B01–B22 audit. Prior results were consulted to identify overlap, not rerun or counted as new evidence by this subtask.

No new failure-injection sensitivity run was performed: these are contract-derived exploratory cases, not confirmed-defect regressions. Both probes actively observe export and queries, and therefore do not establish equivalent behavior in an otherwise completely unobserved history. They do not cover native method assembly over these exact gates, external authority, supported reflection failures during copied publication, deep cyclic reactivation, copy-destination failure, all Array remap methods, work bounds, or garbage-collection lifetimes. Other review tracks may examine some of those dimensions; this report makes no disposition for them. In particular, metadata retirement is not evidence that every ordinary JavaScript reference was collected.

The checked transitions preserved the expected behavior in these bounded cases. That is the conclusion supported by this review, not an assertion that shared delivery or adjacent mechanisms have no remaining defects.
