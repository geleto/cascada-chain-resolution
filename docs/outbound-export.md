# Outbound export

**Status:** source-free capture and canonical assembly are implemented with write-based command identity. N1 protection-copy witnesses and the expanded [Phase 3 scoped-deletion histories](runtime-evolution-plan.md#6-corrections-and-review-experiments) pass. The approved [N2 preservation cutover](runtime-evolution-plan.md#n2-method-result-validation-identity) awaits implementation; production still has the validation-copy fresh-identity gap. Export receives prepared graphs; detached output copies acquire no managed parents.

Managed export uses captured identity partitions under the [write-based contract](data-limitations.md#managed-identity). Capture source-free records and complete required data/Error collection first. On success, resolve captured Array lengths and identity grouping before allocating one final object per canonical key. Failed capture discards output and releases shape questions without waiting for shape or identity. Assembly has no waits, provisional duplicate shells, or rewiring pass.

Export enforces the external-capability restriction: an identity recorded in this execution's external binding map is rejected with `ExternalCapabilityEscape`, including invalid bindings and identities reached after Promise fulfillment. Export still treats external state as opaque and acquires no external phase. The existing copier preserves unregistered observation-only identities exactly; it cannot create or transfer authority.

## Consumers and snapshots

The shared capture/assembler serves managed script results, host-call argument batches, callback inputs, internal snapshots such as Array comparator input, external-property assignment values, and export of observation-only external reads after import. Both native managed receiver modes reuse it with their own admission policy; see [managed invocation](managed-invocation.md#call-lifecycle).

Mutable-external property reads and their direct export use `snapshotExternalValue` for ready-data capture, followed by the shared identity resolver and assembler. Its source-to-record map preserves repeated addresses and cycles. It reads admitted managed sources through logical placements and rejects unresolved nested data, presence or length without subscribing. Every distinct physical representation is inspected even when its captured identity is shared. Ready property order, Array length, prototypes and entries are captured before source access ends.

The snapshot releases its external observation reservation and source references after data/Error capture. A successful capture may then wait for identity grouping; this is not an invalid snapshot. Later native work must not wait behind that identity decision. Data failure discards capture without identity waits. Assembly allocates one shell per canonical key. Lookup admits final copies with fresh identities and initializes their parents; direct export transfers them without admission or another copying pass. This consumer correction is independent of the pending N2 method-result preservation cutover.

## Copying

One export operation uses one weak representation-to-identity map, one set of capture records, and one Error accumulator across the entire batch. A key-to-record map shares data for known equal keys during capture; identity resolution replaces it with the final canonical map used by assembly. Capture tokens retain no source storage: a later mutation reusing the same JavaScript address cannot collide with an earlier captured generation. An original and its representation-only native observation copy share an output shell, preserving aliases across argument positions. Each required physical representation still receives its own inspection; an equivalent copy cannot hide another representation's reflection failure. Required root positions remain ordered; semantic Error membership has no separate per-root domain.

Capture records retain admitted prototypes, captured structure and ordered properties until successful assembly. Managed edges refer to other records, not source containers. Capture fixes the shape question before source release; successful assembly waits for its captured answer and adds no source reread. This keeps necessary graph-sized capture storage while eliminating duplicate host objects and property rewrites. Native receiver preparation uses this same capture and assembler. It admits its working copies and assigns inherited or fresh identity according to the call mode; export leaves its copies outside admission. Receiver and explicit arguments remain separate alias domains because exported arguments are independent host data that a method may retain or mutate.

`resolveCapturedIdentities` follows Phase 3's forwarding links, deduplicates current representatives, groups them by immutable lineage and compares each non-anchor representative with one anchor in that group through `compareIdentities`. It normalizes every record again after comparisons finish. Known equal representatives already share identity; a lone representative needs no comparison wait, and equality can complete while a common predecessor remains pending. Distinct unresolved representatives in one lineage may wait conservatively, including an older pending key and a settled fresh successor that cannot merge with it. The resolver adds no history/order proof to obtain an earlier negative answer. Ready values alone therefore do not guarantee synchronous export; completion is synchronous when all required data, lengths and comparisons complete directly.

For `V` captured records and `E` root/edge positions, records require `O(V + E)` space; grouping adds `O(V)` temporary space/work and at most `V - 1` anchor comparisons, with identity normalization and pending comparisons retaining Phase 3's bounds. Assembly allocates one container per canonical key. It takes expected linear work without record-order sorting; records with order tokens call `orderRecordKeys`, giving an overall bound of expected `O(V + E log(1 + d))`, where `d` is the largest record property count.

The copier:

- resolves every reached logical Promise through its captured property version;
- copies managed records, Arrays, and class instances;
- preserves Array length, holes, indexed keys, own-key order, enumerable `__proto__`, and admitted prototypes;
- creates class copies without invoking constructors;
- keeps Functions and external identities exact; and
- emits no ArrayView, Promise version, metadata, counter, or other runtime representation.

Every successful output follows the native `then` contract in [`data-limitations.md`](data-limitations.md). Exact Functions and external leaves must have a stable native lookup that safely yields a non-callable value from their first use onward; ready and pending export both preserve those exact identities. Managed producers reject callable `then` placements, while declaration and snapshot prototype validation and the host's native-surface stability obligations protect the rest of lookup. Export copies only language placements and preserves admitted prototypes; it does not copy hidden properties or add an exact-value probe or result wrapper.

Each successful batch root retains its own result position. Any reached Error prevents the whole host call after all required roots and nested branches finish collection.

## Errors

The walk collects every contextual Error reached beneath each root. One
semantic failure is preserved. Several produce a `CompoundPoisonError`; one final combination
flattens nested compounds and deduplicates by raw cause, source-context identity,
and kind, sharing the rule used by `getErrors`. Error order and representative
wrapper/source are unspecified; successful batch-root positions remain ordered. Any
Error prevents host invocation or assignment. No Error is exported.

An Error discards partial output but does not stop the scan: pending captured branches may reveal other Errors. Capture candidate keys and validate each placement descriptor before consuming values. A descriptor failure contributes its Error while other known keys remain required; a key-list failure ends only the undiscoverable interior. The same rule applies to records, Arrays, and bounded ArrayViews, whose candidate walk stays inside the selected range. Export never starts a second `getErrors` operation.

## Promise ordering

Export traverses every available placement synchronously. A pending placement is captured through its exact Promise version. Its FIFO continuation traverses each newly revealed branch synchronously once before returning.

The operation retains output state, identity tables, and captured property versions. Output state consists of capture records until assembly; no host shell is allocated while capture is pending. It does not lease or reread managed source identities. Later managed mutation may therefore proceed normally without changing the captured output.

Public export captures a selected Chain/path. Internal value export serves argument batches and outward writes; it is not a separate public result API. Receive fresh managed sources through common input preparation before the copier reads them, including outward-only assignments. Reuse completed preparation and exact captured versions rather than consuming raw inputs twice. Source containers gain their complete internal relationships; detached output copies remain outside managed admission and parent indexing. Input-preparation failures retain `OperationInputFailed` at outward reception, while distinct export inspection failures use `ExportReflectionFailed`. A caller waiting before export starts owns the input protection needed during that wait. Under the [receiving contract](integration.md#export-capture-and-source-release), each direct input callback preserves its value, prepares newly available structure, and copies available state before further suspension or producer cleanup. This adds no blanket source-identity lease over export traversal or output completion.

Export captures only the selected path and the Promise frontier recursively exposed from it. It does not wait for unrelated graph Promises or build a refcount index. A rejected data Promise is already contextualized by the boundary that introduced it; export preserves that occurrence.

For script return, issue public export from the result Chain/path before clearing its temporary holder. A pending expression result can first enter a result Chain through immediate handoff and then use the same public export. Do not defer first capture to an unprotected lookup-result Promise callback. Once export has accepted preservation responsibility, temporary root clearing need not await completed output. Host delivery still waits for the complete export, including required nested data, Errors, and the logical identity decisions specified by [phase 4](runtime-evolution-plan.md#phase-4-resolve-copy-identity-and-deduplicate-exports). Capturing input, ending managed-source access, and completing host output are distinct lifetime points; retaining the detached output does not keep an input lease alive.

## Output lifetime

Export operation work uses its containing operation's owner, or its own owner when export is standalone. A nested export receives only that owner, whose operation context is therefore authoritative. Export output has a separate resource lifetime: handing completed copies to the caller or discarding them releases output-only records, copies, and identity maps without closing a containing operation. Export runs each possible-Promise branch first and derives pending lifetime from the normalized aggregate result, not from an input pre-scan or output backwrite. A pending nested export registers its release with the owner and unregisters on completion, so owner closure releases partial output even when an input never settles. A language Error discards output while the required Error scan continues; under the selected design this releases capture records before any host object is allocated. Pending callbacks retain only destinations that can be cleared, plus dependencies still required for Error collection. After required shared settlement, local owner closure in a live execution stops later export traversal. If the execution is fatal, a resumed export returns at the common execution check before settlement or traversal.

In a live execution, an already-registered property continuation still completes its Promise version and version settlement, then performs no export allocation, source reflection, or publication after local operation closure. In a fatal execution it performs neither settlement nor export work.

The result is synchronous when every consumed frontier transition returns directly, including sync-first custom thenables. Otherwise one operation Promise fulfills with the completed copy or the final ordinary language Error. Export reflection failures use the export operation's source and kind; unexpected internal readiness failure becomes a fatal `FatalError` at that operation.

## Ownership

Exported copies add no managed parent to their source. Current placements, retained uses, and imported-data protection preserve inputs until capture. Application code must not mutate managed data after passing it to Cascada. Exact external state remains governed by its own ordering and mutation authority; export grants none.

`src/export.js` owns `exportValue`, `exportManyValues`, Error collection, and output lifetime. `src/managed-capture.js` owns shared record capture, canonicalization and assembly; `src/managed-traversal.js` supplies ordered key capture and placement delivery. Managed invocation coordinates receiver and argument capture locally, without an optional receiver-preparation argument to export. The exporter reserves ordered capture entries and allocates host objects only after successful capture. `src/internal-step.js` owns complete root readiness and guarded continuation, while `src/operation-lifecycle.js` owns operation closure and releases; ordinary callers select the batch or single-value export boundary.
