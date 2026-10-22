# Outbound export

**Status:** source-free capture and canonical assembly use write-based command identity. Prepared method results preserve their captured identity and pending obligations. Export receives prepared graphs; detached output copies acquire no managed parents.

Managed export uses captured identity partitions under the [write-based contract](data-limitations.md#managed-identity). Capture source-free records and complete required data/Error collection first. On success, resolve captured Array lengths and identity grouping before allocating one final object per canonical key. Failed capture discards output and releases shape questions without waiting for shape or identity. Assembly has no waits, provisional duplicate shells, or rewiring pass.

Export enforces the external-capability restriction: an identity recorded in this execution's external binding map is rejected with `ExternalCapabilityEscape`, including invalid bindings and identities reached after Promise fulfillment. Export still treats external state as opaque and acquires no external phase. The existing copier preserves unregistered observation-only identities exactly; it cannot create or transfer authority.

## Consumers and snapshots

The shared capture/assembler serves managed script results, host-call argument batches, callback inputs, internal snapshots such as Array comparator input, external-property assignment values, and export of observation-only external reads after import. Both native managed receiver modes reuse it with their own admission policy; see [managed invocation](managed-invocation.md#call-lifecycle).

Mutable-external property reads and their direct export use `snapshotExternalValue` for ready-data capture and the shared assembler. Its source-to-record map preserves repeated addresses and cycles. It reads admitted managed sources through logical placements and rejects unresolved nested data, presence or length without subscribing. Every distinct physical representation is inspected even when its captured identity is shared. Ready property order, Array length, prototypes and entries are captured before source access ends.

Snapshots honor [declarations and defaults](data-limitations.md#classification-and-declarations) recursively: managed data is copied through data descriptors, external leaves stay exact and opaque, and registered mutable capabilities fail. Undeclared native classes and explicitly external records/Arrays remain opaque. Direct export and lookup-then-export agree on those leaves; neither invokes ordinary property getters inside managed-shaped snapshot data; availability recognition retains its separate native `then` lookup.

The snapshot releases its external observation reservation and source references after data/Error capture. Lookup groups currently proved aliases and immediately admits managed copies; each incoming identity domain receives one fresh domain while its captured mutation cells remain shared. This preserves snapshot freshness and future alias decisions without listeners, source references, or chains of snapshot mappings. Existing managed consumers use those ordinary values. Direct export instead waits for a fixed identity partition before assembly and transfers canonical copies without admission. Both routes use the same shell/edge assembly and discard capture records afterward. Data failure waits for neither. Native export or receiver preparation of a previously admitted snapshot still resolves its aliases normally.

## Copying

One export operation uses one weak representation-to-identity map, one set of capture records, and one Error accumulator across the entire batch. A key-to-record map shares data for known equal keys during capture; identity resolution replaces it with the final canonical map used by assembly. Capture tokens retain no source storage: a later mutation reusing the same JavaScript address cannot collide with an earlier captured generation. An original and its representation-only native observation copy share an output shell, preserving aliases across argument positions. Each required physical representation still receives its own inspection; an equivalent copy cannot hide another representation's reflection failure. Required root positions remain ordered; semantic Error deduplication spans the batch under the [reporting contract](data-limitations.md#deterministic-error-reporting), including its import-source exception. Collected Error order is temporarily unspecified.

Capture records retain admitted prototypes, captured structure and ordered properties until successful assembly. Managed edges refer to other records, not source containers. Capture fixes the shape question before source release; successful assembly waits for its captured answer and adds no source reread. This keeps necessary graph-sized capture storage while eliminating duplicate host objects and property rewrites. Native receiver preparation uses this same capture and assembler. It admits its working copies and assigns inherited or fresh identity according to the call mode; export leaves its copies outside admission. Receiver and explicit arguments remain separate alias domains because exported arguments are independent host data that a method may retain or mutate.

`resolveCapturedIdentities` groups captured keys by domain and current mutation-cell representative, then compares each non-anchor cell with one anchor in that domain through `compareIdentities`. It groups every record again after comparisons finish. Known equal representatives already share identity; a lone representative needs no comparison wait, and equality can complete while a common predecessor remains pending. Distinct unresolved cells in one domain may wait conservatively, including an older pending cell and a settled successor that cannot merge with it. The resolver adds no history/order proof to obtain an earlier negative answer. Ready values alone therefore do not guarantee synchronous native export; completion is synchronous when all required data, lengths and comparisons complete directly.

For `V` captured records and `E` root/edge positions, records require `O(V + E)` space; grouping adds `O(V)` temporary space/work and at most `V - 1` anchor comparisons, with identity normalization and pending comparisons retaining Phase 3's bounds. Assembly allocates one container per canonical key. It takes expected linear work without record-order sorting; records with order tokens call `orderRecordKeys`, giving an overall bound of expected `O(V + E log(1 + d))`, where `d` is the largest record property count.

The copier:

- resolves every reached logical Promise through its captured property version;
- copies managed records, Arrays, and class instances;
- preserves Array length, holes, indexed keys, own-key order, enumerable `__proto__`, and admitted prototypes;
- creates class copies without invoking constructors;
- keeps Functions and external identities exact; and
- emits no ArrayView, Promise version, metadata, counter, or other runtime representation.

Every successful output follows the native `then` contract in [`data-limitations.md`](data-limitations.md). Exact Functions and external leaves must have a stable native lookup that safely yields a non-callable value from their first use onward; ready and pending export both preserve those exact identities. Managed producers reject callable `then` placements, while declaration and snapshot prototype validation and the host's native-surface stability obligations protect the rest of lookup. Export copies only language placements and preserves admitted prototypes; it does not copy hidden properties or add an exact-value probe or result wrapper.

Each successful batch root retains its own result position. Any reached poison prevents the whole host call after all required roots and nested branches finish collection.

## Errors

The walk collects every poison reached beneath each root. One
semantic failure is preserved. Several produce a `CompoundPoisonError`; one final combination
flattens nested compounds and deduplicates by raw cause, source-context identity,
and kind, sharing the rule used by `getErrors`. Established producer contexts determine
deduplication and compound diagnostics under the reporting contract above.
Successful batch-root positions remain ordered. Any
poison prevents host invocation or assignment. No poison is exported. Ordinary native Errors are healthy opaque data and cross export unchanged, including argument and result export.

Poison discards partial output but does not stop the scan: pending captured branches may reveal other poison. Capture candidate keys before reading descriptors, then consume one complete placement at each key's traversal turn. Its presence, value and exact pending version come from that read, without separate presence filtering or version reacquisition. A descriptor failure contributes its poison while other known keys remain required; a key-list failure ends only the undiscoverable interior. The same rule applies to records, Arrays, and bounded ArrayViews, whose candidate walk stays inside the selected range. Export never starts a second `getErrors` operation.

## Promise ordering

Export captures available roots and placements before joining pending descendants. Pure managed inspection may follow availability; assembly preserves root positions and captured property order regardless of delivery order. Recoverable inspection failure contributes poison while other accessible placements remain required.

The operation retains output state, identity tables, and captured property versions. Output state consists of source-free capture records until assembly; no host shell is allocated while capture is pending. Direct roots are received and captured immediately; pending children retain their exact versions rather than the former source container. Source protection ends at last access. Later managed mutation follows ordinary ownership and copy-on-write; no source lease extends solely for another branch, identity resolution, assembly or host use.

Public export captures a selected Chain/path. Internal value export serves argument batches and outward writes; it is not a separate public result API. Receive fresh managed sources through common input preparation before the copier reads them, including outward-only assignments. Reuse completed preparation and exact captured versions rather than consuming raw inputs twice. Source containers gain their complete internal relationships; detached output copies remain outside managed admission and parent indexing. Input-preparation failures retain `OperationInputFailed` at outward reception, while distinct export inspection failures use `ExportReflectionFailed`. A caller waiting before export starts owns the input protection needed during that wait. Under the [receiving contract](integration.md#export-capture-and-source-release), each direct input callback preserves its value and prepares newly available structure before producer cleanup. Once capture starts, it consumes each delivered value without waiting for another root's traversal.

Export captures only the selected path and the Promise frontier recursively exposed from it. It does not wait for unrelated graph Promises or build a refcount index. A rejected data Promise is already contextualized by the boundary that introduced it; export preserves that occurrence.

For script return, issue public export from the result Chain/path before clearing its temporary holder. A pending expression result can first enter a result Chain through immediate handoff and then use the same public export. Do not defer first capture to an unprotected lookup-result Promise callback. Once export has accepted preservation responsibility, temporary root clearing need not await completed output. Host delivery still waits for the complete export, including required nested data, Errors, and the logical identity decisions specified by [phase 4](runtime-evolution-plan.md#phase-4-resolve-copy-identity-and-deduplicate-exports). Capturing input, ending managed-source access, and completing host output are distinct lifetime points; retaining the detached output does not keep an input lease alive.

## Output lifetime

Export operation work uses its containing operation's owner, or its own owner when export is standalone. A nested export receives only that owner, whose operation context is therefore authoritative. Export output has a separate resource lifetime: handing completed copies to the caller or discarding them releases output-only records, copies, and identity maps without closing a containing operation. Export runs each possible-Promise branch first and derives pending lifetime from the normalized aggregate result, not from an input pre-scan or output backwrite. A pending nested export registers its release with the owner and unregisters on completion, so owner closure releases partial output even when an input never settles. A language Error discards output while the required Error scan continues; under the selected design this releases capture records before any host object is allocated. Pending callbacks retain only destinations that can be cleared, plus dependencies still required for Error collection. After required shared settlement, local owner closure in a live execution stops later export traversal. If the execution is fatal, a resumed export returns at the common execution check before settlement or traversal.

In a live execution, an already-registered property continuation still completes its Promise version and version settlement, then performs no export allocation, source reflection, or publication after local operation closure. In a fatal execution it performs neither settlement nor export work.

The result is synchronous when every consumed frontier transition returns directly, including sync-first custom thenables. Otherwise one operation Promise fulfills with the completed copy or the final ordinary language Error. Export reflection failures use the export operation's source and kind; unexpected internal readiness failure becomes a fatal `FatalError` at that operation.

## Ownership

Exported copies add no managed parent to their source. Current placements, retained uses, and imported-data protection preserve inputs until capture. Application code must not mutate managed data after passing it to Cascada. Exact external state remains governed by its own ordering and mutation authority; export grants none.

`src/export.js` owns `exportValue`, `exportManyValues`, Error collection, and output lifetime. `src/managed-capture.js` captures managed placements in source order, including pending delivery. It extends the source-free output in `src/captured-graph.js`, which owns shape/identity completion, canonical assembly and disposal. Ready-only external snapshots produce that same output directly, without managed traversal state. Managed invocation coordinates receiver and argument capture locally, without an optional receiver-preparation argument to export. The exporter reserves ordered capture entries and allocates host objects only after successful capture. `src/internal-step.js` owns complete root readiness and guarded continuation, while `src/operation-lifecycle.js` owns operation closure and releases; ordinary callers select the batch or single-value export boundary.
