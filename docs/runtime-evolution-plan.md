# Runtime evolution plan

This is the active implementation plan. It owns the remaining work previously listed as phases 9F-D, 10, 11, and 13 in the [completed-work record](first-principles-conformance-plan.md). The selected ownership, no-op reuse, and export architecture is specified here; no separate identity design or review document is required.

1. [Preserve incoming parent relationships](#phase-1-preserve-incoming-parent-relationships).
2. [Replace permanent sharing with maintained ownership](#phase-2-replace-permanent-sharing-with-maintained-ownership).
3. [Unzip unchanged mutation copies](#phase-3-unzip-unchanged-mutation-copies).
4. [Deduplicate export and unify identity consumers](#phase-4-deduplicate-export-and-unify-identity-consumers).
5. [Support Promise-valued path segments](#phase-5-support-promise-valued-path-segments).
6. [Review imported-Promise settlement ownership](#phase-6-review-imported-promise-settlement-ownership).
7. [Cut Cascada over to the execution Error architecture](#phase-7-cut-cascada-over-to-the-execution-error-architecture).

Phases 1–4 replace the former phase 9F-D. Phases 5, 6, and 7 preserve former phases 10, 11, and 13 respectively, with their references updated. Completed foundation phases retain their historical identifiers in the older record. Migration does not mark an unfinished phase implemented or settle an evaluation explicitly left to that phase. Arbitrary native receiver no-op comparison and comprehensive lifetime reclamation remain deferred.

## Implementation and verification

Use [AGENTS.md](../AGENTS.md) and the [data contract](data-limitations.md) as the existing semantic foundation. Any explicit target revision in this plan must update the runtime contract and independent test oracle when implemented. Keep representation choices local and reuse existing publication, ownership, and operation-lifetime mechanisms.

Implement phases in dependency order. For each phase, reproduce the affected public behavior, extend the relevant sequence/conflict models and storage/refcount verifiers, run the required checks and larger configurations in the [test guide](../test/README.md), and remove superseded mechanisms in the same change. A standalone model with supplied identity answers is not evidence that runtime classification, publication, or retention is correct. Measure allocation and pending-work costs before adding caches or alternative execution paths. Resolve equivalent internal implementation choices autonomously; bring back a concrete issue only if it changes agreed semantics or exposes a material unresolved tradeoff.

## Phase 1: Preserve incoming parent relationships

**Status: design ready for implementation; runtime implementation has not started.** This phase establishes parent information independently of Promise/Error refcounts. It does not implement unzipping, export identity, or a new mutation/ownership policy. Tracking covers ordinary managed placements, not only provisional copies. Phase 2 takes up ownership and explicit retention lifetimes; that work is not a prerequisite for phase 1.

### 1. Principles and required result

A child cannot discover its outside parents by traversing its own descendants. Preserve a relationship while its source location is known, before returning or copying the child loses that information. Do not build refcounts, scan unrelated owners, or walk a graph again to reconstruct a missed parent.

A relationship identifies a current logical `(parent, key)` placement whose value is a managed container. It follows property versions and Array projections, not merely physical JavaScript properties. Relationships may be stored directly or represented through an Array backing record that enumerates the actual placements. Completeness concerns those logical placements, not the number of stored records. A Chain's root-holder `value` property is an ordinary placement. Detached historical versions, recovery captures, host variables, and exported objects are not additional current parent placements; their existing retention rules continue to apply.

The required result is:

- Once parent tracking is initialized for a node, it is complete and remains maintained through later attachment, replacement, and removal.
- Before initialization, a published node has at most one incoming placement, recoverable from the source placement through which the runtime reaches it. A fresh unattached root has none.
- Every operation that could create a second placement or expose a value without its source location initializes tracking first. Import/adoption establishes the complete incoming relationships of graphs that already contain aliases or cycles.
- Parent tracking neither implies nor initializes the counter index. Its correctness is independent of `shared`, leases, and whether an Error query has run.

This is a requirement on construction and retention paths, not an inference from `shared === false`. Private graph construction can temporarily create arbitrary topology, but must establish its parent facts before publication or escape.

### 2. Minimal information and initialization

The logical representation is one optional execution-local metadata field:

```js
incomingParents: Map<parentSource, Set<key>>
```

An absent field denotes an uninitialized node under the single-placement invariant above. An empty initialized map means there are no current incoming placements. They are not interchangeable. Keep current property versions on their owning containers; the reverse index needs no duplicate version, mutation counter, original pointer, or operation history. This phase uses ordinary strong parent references; section 6 defines the deliberately deferred lifetime work.

For ordinary placements, `parentSource` is the logical parent and keys are its logical keys. For shared Array storage, it is an internal backing record and keys are physical indexes; section 4 defines expansion into logical parent/index pairs. Repeated registration is idempotent. A backing entry can represent many logical placements, so neither map size nor key-set size is a sharing count. Do not add a singleton encoding or cache another count in this phase. Refcount propagation keeps its existing acyclic projection and logical-parent multiplicities in `meta.parents`; a backing record never enters that graph, and the incoming field must not become its index-initialization marker.

Initialize from one of two already available sources:

1. **A source placement.** A retaining lookup knows the existing parent and key. Before returning its value, initialize the child's map with that placement, or ensure the placement is present in the existing map. The same operation applies when a copier, entry, or Array helper retains a value from a known location.
2. **A newly admitted or constructed graph.** Its required import/adoption walk supplies every internal edge. Initialize fresh roots with no outside parent and register internal edges, including edges back to the root. Merge into existing metadata; reimport never clears earlier parents.

Ordinary non-retaining reads do not need a map merely because they inspect a value. A newly allocated path container can remain uninitialized at its first attachment while its sole location is recoverable. Before it is retained, copied again, or used as the root of an index operation, its source location must be supplied to initialization. These are the only circumstances in which omitting that first stored relationship is justified.

Prefer this omission only where the existing path or construction work already supplies the proof. Do not add a permanent first-parent pointer, an origin history, or a second initialization flag to make laziness possible. Where source information would otherwise be lost, initialize at the earlier known attachment instead. Always recording every fresh edge has a simpler invariant but retains collections for unique temporary containers; the proposed rule avoids that cost without guessing an earlier location. Its overall performance still requires measurement.

### 3. One source-retention rule, one placement-update rule

**Preserve the source relationship before retaining a value; maintain the destination relationship when committing a placement change.** This separates the initial parent from later parents without introducing different algorithms for each command.

| Runtime event | Required behavior |
| --- | --- |
| Initial import, including Promise-delivered imports | Record every managed internal edge during the existing staged walk/commit. A repeated child skips recursive inspection, not registration of the new parent/key occurrence. |
| Lookup or another retained read | Initialize from the selected source placement before its identity escapes. An already initialized map receives an idempotent registration of that current location. |
| Assignment or Chain construction | The RHS arrives with initialized parent information, or is a fresh value whose construction supplies the initial facts. Add the destination; remove its old value's incoming entry when replacing it. |
| Parent COW, Array copying/remapping, or an entered/private Chain | Preserve the original source placement before adding the copied placement. These are implicit retained reads and assignments; an explicit language lookup is not required. |
| Managed native receiver/result adoption | During the already required final graph walk, establish actual edges after native writes and before publication. Do not intercept individual native writes or assume receiver copying preserved parent metadata. |
| Delete, overwrite, truncate, or move | Remove each location that ceases to hold its old value and add the new location if present. Replacing a branch root changes that direct edge, not every descendant's immediate parent. |
| Promise settlement or gate publication | Apply the same placement update to the available logical value before exposing completion to consumers. A detached version cannot register its former live parent. |
| Counter indexing | Preserve the selected root's outside parent at source capture; discover internal edges in the existing indexing walk. Reuse initialized incoming facts. Do not attempt to reconstruct outside parents from the indexing root. |

Two examples determine where initialization cannot be omitted:

- Copying `P` with `P.x === C` creates `Q.x === C`. If `C` has no map, first register `P.x`, then `Q.x`. Registering only the new destination loses the source. The copy loop already knows both locations.
- Importing `{a: x}` and later importing host-held `x` as a separate root does not involve lookup. The first import must record its internal edge to `x`; the second cannot rediscover that parent from `x` alone.

Import therefore does more than initialize its top-level root. Conversely, assigning an already retained branch requires no new walk of that branch. Every actual new incoming placement becomes represented at attachment, either directly or through a new view's membership in its backing record.

Keep `markShared` as the ownership operation. Its call sites identify places to audit for source retention, but a value-only call cannot recover an already discarded parent/key. Preserve those facts where the source placement is still available. Do not make parent-map size an ownership test, clear sharing on deletion, or force COW merely because parent metadata exists.

### 4. Publication and representation details

Record the logical owner, normalized key, and current value. Prepare registration facts during existing fallible reads; commit incoming removals/additions together with successful logical publication and the ordinary counter updates. Failed writes retain the previous relationships. Failed staged import or native adoption publishes no partial live index. Shared Promise publication maintains its relationships even if the initiating operation's local consumer has closed.

For a pending retained read, retain the source placement/version needed to initialize on delivery. Register its parent only while that source is still installed and holds the delivered value. If it has detached, maintain the retained capture without inventing a live parent. A later assignment still registers its own destination. Existing retention and guarded continuations carry this dependency; no separate pending-parent task registry is needed.

ArrayViews share physical storage but own distinct logical placements. If `A[5] === child` and a view starts at index 5, the child's parents include `(A, "5")` and `(view, "0")`. The representation records the shared storage occurrence once and derives those placements when needed, avoiding a ready overlay and reverse entry for every child in every view.

An execution-local **Array backing record** holds the physical Array and a registry of its logical owners. Each owner supplies its existing projection, offset, and logical bounds; do not duplicate those shape facts. A native Array is one logical owner. Its attached internal projection is not an additional owner. A separately published ArrayView is another owner. The record is runtime metadata, never a language graph node or exported value. It can be associated with the Array's execution metadata; wrapping every storage access is not necessary merely to retain the registry.

Use two existing sources of a logical slot's value:

- **Backing storage:** the child's incoming map records the backing record and every physical index containing it. Repeated occurrences of one child need all their indexes. Create the backing record lazily when the first such relationship or view registration needs it. Use this representation for tracked physical Array slots before the first view too, so adding views does not require migrating old child entries or rescanning the Array.
- **An owner's placement overlay:** the child has an ordinary direct `(owner, logicalKey)` incoming entry. Copying or settling that overlay uses ordinary placement publication. A pending overlay, absence overlay, or ready override masks the backing occurrence for that owner, even when its eventual or current value equals the backing value.

To enumerate a child's parents, expand its known backing indexes through the registered owners. Translate `logicalIndex = physicalIndex - start`, check the owner's current logical range, and exclude locations with an overlay. Direct entries supply the overlay-held occurrences. This yields each placement once, including when the same child appears in several backing slots or in both backing and overlays. Use the existing ordered shape/presence facts; neither physical length nor a pending maximum proves that a logical placement exists. Merely enumerating candidates must not consume unrelated pending values or reinterpret a detached version as current.

This range check needs no host read. For an unprojected native Array, a maintained present physical index already proves range membership. For an owner with a projection, use its stored start and committed length. Array backing expansion must not call the ordinary native-Array length reader or create shape metadata solely to answer this query.

The existing first-retention scan establishes backing relationships for newly encountered managed children. Subsequent view derivations register one new owner with that backing record, transfer only the overlays already required for logical values, and capture the existing unretained suffix. They add no overlay solely for a ready backing child. Physical slot changes maintain the affected backing entries through their common write boundary. Logical overrides maintain direct entries while leaving the backing relationship available to other owners. Removing an overlay can expose a backing relationship again only under the ordinary placement rules. Once a physical managed-child occurrence is tracked, retain its backing fact while the slot holds that child, even if current owner bounds or overlays mask every use.

Materialization constructs a fresh Array with its own backing facts. The old view remains registered while it still represents its old storage; replacing a Chain root alone is not disposal. Failed construction must not expose a partially prepared logical owner. These rules preserve the same source-retention and publication boundaries as ordinary placements.

Unzipping will consume the enumerated logical `(parent, key)` placements through common logical publication. The backing record does not authorize a raw shared-slot replacement: that would bypass overlays, captured versions, and per-owner counter updates. It may create an overlay for an affected slot when substitution actually happens. Optimizing an equivalent substitution across the physical backing is separate work; it is unnecessary to avoid per-child bookkeeping at every view creation.

This phase records native-created aliases but does not by itself fix the previously identified mutation-through-unshared-alias behavior. Import protection already works; native alias protection and the chosen effective-write semantics remain separate work. Parent indexing must not silently change them.

### 5. Encapsulation and implementation sequence

Keep one internal parent-relation helper beneath the existing placement machinery. Its small responsibility is to initialize from known source/adoption facts, register or remove a source/key idempotently, and enumerate current logical parent placements. The Array module owns backing membership and projection into logical placements. The common helper does not read host properties, classify values, traverse a graph, decide sharing, or build refcounts. Callers supply already admitted identities, normalized keys, and captured placement facts. Consumers such as unzipping see logical placements through this surface rather than inspecting backing registries themselves.

Expose one internal read operation:

```js
getParentPlacements(node, operationContext) // Array<{ parent, key }>
```

Its contract is:

- Return a synchronous snapshot of current logical placements holding the supplied managed node, with normalized string keys and each `(parent, key)` appearing once. Result order has no semantic meaning. Return a separate result collection, not a mutable reference to the stored index.
- Read ordinary direct entries as placements. Expand Array backing entries through their registered owners, current bounds, and overlay masks. Array overlay entries are direct entries too; the distinction is where the slot's value comes from, not merely whether its parent is an Array.
- Use maintained identity, location, overlay, and shape facts. Do not scan backing elements, perform host reflection, initialize refcounts, or resolve pending payloads. A pending placement does not yet hold its eventual managed child; common publication adds that child's relationship when available. In-range backing membership relies on committed bounds, never a speculative maximum; pending transitions remain governed by their overlays.
- Require initialized parent tracking. The caller establishes that fact from its known source placement or construction/adoption work before querying; the helper trusts this internal invariant. An absent index must not silently mean an empty parent list, and the read operation cannot reconstruct a lost source.
- Treat results as locations observed at the call, not as authority to overwrite them later. Consumers use normal placement/version capture and publication checks. A consumer that suspends must revalidate its captured placements or query again before updating them.

A snapshot lets unzipping update placements without mutating the collections it is still enumerating. No lease is needed merely to assemble it: enumeration uses internal facts synchronously and invokes no user callbacks. Later comparison, waiting, and publication retain their own ordering and protection responsibilities. Keep this API internal; it does not expose backing records or add another public graph query.

Implement at common boundaries rather than adding parent protocols to individual mutators:

1. **Define and verify the metadata invariant.** Add the incoming representation and an independent verifier. Distinguish it from the existing counter projection and prove initialization preserves any earlier known parents.
2. **Connect source capture and import.** Retaining lookup, import/adoption, and graph-index entry must preserve the first parent before reducing a placement to a bare value. Keep source coordinates in the existing work only until that initialization is complete.
3. **Connect common destination commits and copying.** Cover ready writes, pending publication, Chain holders, captured entry holders, COW child reuse, Array placement transfer, and removal. Bootstrap from the source when copying an uninitialized child; never guess that it was a fresh root at the destination.
4. **Complete graph-producing boundaries and ArrayViews.** Native receiver/result adoption establishes its finished topology through the existing walk. Route physical Array parent facts through backing records, register logical owners at view publication, and retain direct overlay parents. Verify expansion against logical placement enumeration, including the first native-Array-to-view transition and later masking/unmasking.
5. **Run the connected checks below.** Parent tracking must work before any refcount index exists and remain consistent when refcounts are added later.

The main integration points are [property versions](../src/property-versions.js), [path observation](../src/observations.js), [import processing](../src/import-processing.js), common copying in [mutations](../src/mutations.js), [entry](../src/enter.js), [Array remapping](../src/array-remap.js), and [managed invocation](../src/managed-invocation.js). This is a source audit list, not a request for separate implementations in those modules.

### 6. Work bounds and deferred lifetime management

Before counter initialization, retain only the incoming locations that the initialization rules require. Add no Promise/Error summaries, cycle-cut projection, equality state, or mutation history. A ready unique path node needs no incoming collection until its source must be retained. Imported/adopted graphs need their already discovered edges because later access can begin at an arbitrary identity.

Initialized tracking adds expected constant map/set work per stored source/key change. Existing import, copy, adoption, and indexing walks supply edges; parent bookkeeping does not repeat them. For one backing, the added storage is proportional to tracked managed physical occurrences, registered logical owners, and overlay-held managed occurrences, rather than the product of backing children and views.

Registering a new view adds one backing-owner entry. Its existing overlay transfers, first capture or unretained-suffix scan, and any required counter indexing still have their ordinary costs. This is not a constant-time guarantee for every `push`. The current Array method dispatch tries endpoint view derivation without a `shared` condition, so repeated view creation is not limited to programs that explicitly retain the Array after every push.

Expanding a child's backing relationships moves work to the consumer that needs actual placements. With `k` occurrences of that child and `v` registered owners on one backing, simple enumeration can examine `k * v` candidates and filter by bounds and overlays. It does not scan other element values, but it is not necessarily proportional only to the resulting placements. Start with the registry and existing range facts; add an interval index only if measurement justifies it. Unzipping must still update every actual affected logical placement and its counter bookkeeping. Parent compression does not change the existing counter index or its work bounds.

Allocating a ready overlay solely to track every inherited managed child is unnecessary when one shared storage occurrence can represent the same relationships. The selected backing-record representation needs integration validation; design readiness does not establish that the current runtime already implements it.

Lifetime management is deliberately deferred. Strong incoming references may retain old parent generations through a surviving child after their Chain roots are replaced. Phase 1 accepts that retention while preserving correct relationships; it does not add weak references, Chain disposal, reachability collection, or ownership counts. Removing or replacing an actual placement still removes its incoming entry immediately. Losing a root reference alone does not erase the still-existing placements inside that container.

Phase 2 uses the parent data for retained-value accounting and replacement of `shared`, with release at established internal last-use boundaries. Public Chain disposal remains deferred. Phase 1 keeps the relationship helper small so that reference storage and release policy can evolve there. Its completion does not require implementing that policy or comprehensive graph reclamation.

### 7. Verification and completion

Use supported public data entry: host objects enter through import or `ContextChain`. A raw host object passed directly to `Chain` is not evidence that import lost sharing or parent facts. Supplement public scenarios with a verifier that independently enumerates the test's known logical containers and compares their exact incoming locations; it must not derive expected answers from the maintained index.

Required cases:

- Lookup then assignment, direct Chain-root retention, replacement, and deletion, without prior indexing. Repeat with only the source, only the destination, or both counter-indexed.
- An initially untracked runtime-created child retained from its original placement, followed by multiple new parents; repeated lookup adds no duplicate.
- Import aliases, two keys in one parent, distinct parents, cycles, a descendant later imported as a root, and reimport of existing identities without resetting their parents.
- COW of a parent with off-path managed children, Array copying/remapping, returned elements, entered/private holders, and native-created/copied aliases. Exercise routes that perform no explicit lookup.
- Synchronous and pending fulfillment, lookup captured before replacement, detached versions, queued gates, deletion/reinsertion, recovery, and source delivery after consumer closure.
- ArrayView aliases with different offsets, repeated child occurrences, retained-prefix reuse, holes, truncation, pending-to-managed settlement, and projection changes. Compare expanded parent placements with an independent logical graph oracle. Include ready overrides holding the same child as backing, absence/pending masks, restoration of backing fallback, and overlay-only children. An internal projection is not an extra logical parent.
- Initial parent registration before any view, new view registration without per-child updates, fresh appended slots, materialization, and failed view construction. Count backing reads, overlay transfers, registry changes, and expanded candidates separately. Repeated ready-object pushes must not allocate per-child overlays or rescan the retained backing prefix merely to preserve incoming relationships.
- Supported staging/write failures and fatal resumption. No partial incoming state, stale reinstatement, or extra host action after failure.
- Agreement with existing counter/storage verification, including cycle cuts. Initializing incoming metadata alone must neither create a refcount index nor change values, sharing, or mutation behavior.
- Repeated replacement and deletion remove the affected parent/key entries without dropping surviving placements. Do not make reclamation of root-unreachable containers or replacement of `shared` a phase-1 acceptance condition.
- Verify `getParentPlacements` through an independent logical-placement oracle: exact membership without duplicates, no additional backing reads or pending subscriptions, and a result collection unaffected by later index updates. Exercise publication after a consumer suspends so an earlier result cannot overwrite a replacement placement.

Extend the appropriate sequence models and verifiers, then run the checks and larger-scale configurations in the [test guide](../test/README.md) when runtime integration is implemented. No production tests have been run to validate this unimplemented proposal.

This phase's design is ready for implementation and for the later plan phases to build on its internal placement API. Its eventual implementation is complete when the initialization invariant holds for every supported producer, current incoming locations remain correct before and after counter initialization, and the stated work and representation checks pass. Parent preservation must stand on its own before runtime unzipping and export depend on it; comprehensive lifetime handling remains future work.

## Phase 2: Replace permanent sharing with maintained ownership

**Status: design ready for implementation after phase 1; runtime implementation has not started.** Remove `meta.shared` and its marking protocol, deriving preservation from current graph relationships and retained uses. This phase balances lifetimes already owned by the runtime; it does not introduce public result-release or Chain-disposal APIs. Unzipping and export deduplication remain separate phases.

### 1. Purpose and governing rule

The current flag remembers that a value was retained elsewhere, without recording whether that use still exists. Parent relationships provide more precise information about current placements, but do not account for bare lookup results, detached captures, recovery baselines, or borrowed host storage. Replacing the flag therefore requires accounting for those protections as well as graph edges.

The governing rule is: **reuse storage only when the proposed write preserves every other logical value that can still be observed.** A protection acquired for one use ends when that use releases or transfers it, not when an unrelated operation finishes. Removing a graph edge changes graph ownership; it does not release a separately retained result.

This phase changes ownership bookkeeping and reuse eligibility, not language alias semantics. Preserve the mutation boundary's specified behavior for controlled paths and isolated native receivers; phase 3 specifies the target path-local identity rules. A uniqueness result cannot authorize overwriting a generation still needed for comparison, rollback, or earlier publication. Explicit external mutation retains its existing authority rules.

### 2. Ownership facts and their lifetimes

Keep facts at their existing scopes. Graph edges belong to placements, retained uses belong to their holders, and imported-data protection belongs to the admitted identity. Do not flatten them into a second aggregate sharing flag or use the Promise/Error counter projection as an ownership graph.

#### 2.1 Graph placements and Chain holders

Use phase 1's complete incoming relationships for graph ownership, including Array backing expansion. A Chain root is already a placement and needs no additional ownership count for the same reference. Additions, replacement, and deletion change these facts through common publication.

An ordinary Chain keeps its root placement under the current API. Dropping a JavaScript variable is not a runtime release signal. General Chain disposal and reclamation remain future work, rather than prerequisites for replacing the sharing flag. An internally owned temporary or entered Chain can retire its root only after its existing completion boundary has finished or transferred every use of that holder. Callback closure stops issuance; it does not prove already-issued publication complete. If that last use is not established, retain the holder. Retirement removes its root placement through common bookkeeping; it never cancels promised effects or recursively destroys the retained graph.

Parent records describe locations, not independent root owners. Cycles and several paths within one retained graph must not multiply root ownership by path count. Conversely, a child with one immediate parent may still sit below a protected ancestor. The COW decision in section 3 uses the selected mutation path as well as local incoming facts.

#### 2.2 Retained values outside current placements

Account explicitly for every managed value whose logical state must survive independently of its current graph placement. Reuse the existing counted lease machinery for retention where its protection semantics match; keep different release points on their actual holders. Do not add parallel lease and capture mechanisms that represent the same obligation twice.

| Retaining use | Acquisition and release responsibility |
| --- | --- |
| Lookup or another publicly returned managed value | Protect before delivery for the rest of its possible use in this execution. The current raw-result API supplies no release signal; the precise conservative rule is defined below. Assignment does not release this protection. |
| Captured property version or pending input | Record the obligation at capture, before suspension. Protection follows delivery even after the source placement detaches, and ends after the capture's last use or an explicit handoff. |
| Rollback or recovery baseline | Retain while the mutation or installed recovery state can need the baseline. Release when that responsibility is consumed, superseded, or discarded, rather than merely when the mutating callback returns. |
| Read lease or other temporary consumer | Preserve its existing last-access release point. A reader finishing does not release another consumer's capture of the same value. |
| Future copy/source proof | The reuse connection owns its baseline until substitution or retirement. Captures that still require it acquire or receive their own retention before release; an obsolete identity proof does not extend unrelated publication. Phase 3 specifies this handoff. |

Each bounded internal acquisition has one matching release or transfer, implemented at the holder rather than by a mutable operation context or an execution-wide owner registry. Count protection at the retained root; the mutation path carries ancestor protection to descendants without eagerly marking an entire graph.

The public result contract stays unchanged. A raw managed result from lookup, invocation, or import may be retained and reused by its caller at any later point in the execution. Acquire an open-ended root lease before that result becomes observable. The lease has no release in a live execution because the existing API provides no evidence of last use. Imported identity protection can already satisfy the obligation for borrowed host storage. Exported detached copies and non-managed results need no such source lease. Record protection locally; do not register result history or a strong result set on the execution.

For a pending result, record the delivery obligation before returning its Promise. Shared publication establishes protection on the delivered identity before any consumer can resume, even if the source placement has detached. Settling the Promise, closing the producing operation, assigning the value elsewhere, or removing its old parent does not release a publicly returned result. This is an explicit remaining limitation: a value that has escaped through this API need not become writable after its graph aliases disappear. It is not evidence that graph-only sharing must remain permanent.

Internal handoff is more precise because both holders are known. Attach the destination placement or acquire the destination capture's lease before releasing the source lease. A pending handoff transfers the delivery obligation as well as the current capture; there is no unprotected gap and no later reacquisition by a closed holder. Use this same protocol for ready values and pending delivery. A shared producer continues settlement for surviving holders after one consumer releases its own obligation.

Do not add a result wrapper, ambient retention scope, optional ownership mode on every public operation, or a new disposal protocol merely to improve reuse now. A future explicit holder API can make public result lifetimes bounded without changing these internal ownership rules. It must provide an actual relinquishment signal; automatic transfer on assignment would be unsound.

#### 2.3 Imported data and representation lifetime

Use the existing `imported` fact to preserve borrowed managed storage after `markImported` stops setting `shared`. Having one parent or releasing every temporary reader never grants permission to modify the host's original. Imported protection is an identity fact, not an artificial parent or an invented releasable host owner.

Array backing membership describes logical owners still using that representation. Retire membership only when the owner representation is known to be retired, not simply because one Chain changed its root. The same restriction applies to removing outgoing relationships from old containers: a retained capture may still need them.

Balancing known internal retention and retiring holders at established internal last-use boundaries are in scope. Public holder disposal, a general collector for unreachable cyclic graphs, weak-reference timing, and execution-wide reachability sweeps remain deferred. Retain conservative protection where representation retirement is unproved. This may leave avoidable copies or retained storage, but cannot permit premature mutation.

### 3. One COW decision using those facts

Keep `requiresCopyOnWrite` as the internal ownership decision, supplying the selected placement and existing mutation work when needed. The decision answers whether this access requires preservation; it is not `getParentPlacements(node).length > 1`.

For an ordinary controlled path, inspect local protections and the known path from its holder. Imported storage, outstanding retained uses, and protection inherited from an ancestor require preservation. Another incoming placement prevents proving exclusive use of that node through the selected placement. When ancestors are copied, register their reused children before relying on the children's new ownership facts. Private construction and a completely isolated native receiver retain their established ability to update their own working graph, including its internal aliases.

Simple cases should finish using local facts. Ambiguous aliases or cycles may conservatively require copying; do not traverse unrelated ancestors or descendants to prove an optimization. No parent-count shortcut may change alias behavior, bypass a mutation baseline, or overwrite a captured generation. Ownership permission remains separate from storage writability and representation requirements, which continue through ordinary materialization.

Reuse phase 1's parent expansion internally with early exit when another relevant placement is found. `getParentPlacements` keeps its snapshot contract for consumers that need all locations; the COW predicate need not allocate that snapshot. There must be one implementation of Array offsets, bounds, and overlay masking beneath both consumers. Add no cached owner total until a demonstrated cost justifies its invalidation protocol.

Protection must be established before publication exposes a value to later writers. A pending capture therefore retains an obligation before its value is available; settlement attaches the required protection to the delivered identity before consumers resume. Shared settlement and surviving captures continue after one local consumer closes. Release is synchronous, idempotent, and non-throwing, with no host reflection, pending-value consumption, or cancellation of gates or source Promises.

### 4. Encapsulation and implementation sequence

Use a small ownership module beside parent relations. Its responsibilities are counted retention and handoff, release at established internal boundaries, and the COW predicate. Parent relations continue to describe placements; Array code continues to own backing expansion. Existing operation owners and resource-release hooks carry operation-specific lifetimes. No consumer should manage sharing Booleans or interpret raw parent-map sizes.

The existing marking routes have the following replacements. These are uses of common ownership transitions, not separate mechanisms for each caller:

| Current route | Replacement responsibility |
| --- | --- |
| `markImported` during admission | Preserve the admitted identity's `imported` protection. |
| Lookup, returned Array elements, and a returned mutation receiver | Public result retention before escape; bounded handoff only for a wholly internal consumer with a known last use. |
| `copyPlacement`, import/adoption copies, and reused children | Register destination parents; retain detached captures and recovery separately. Ready graph attachment needs no additional permanent lease. |
| `retainPlacement`, pending version delivery, and recovery | Capture-owned delivery obligations and balanced retention through last use or handoff; preserve detached version authority. |
| Mutation attachment roots, pending entry, and publication work | Retention owned by the unfinished publication or captured continuation, released after its actual last access. |
| ArrayView backing attachment | Maintained backing-owner membership from phase 1, with conservative retirement under section 2.3. |
| Existing read leases and argument preparation | Keep their existing bounded last-access rules through the common retention implementation. |

Implement in this order:

1. **Wire the specified handoffs before removing protection.** Audit every `markShared`, `markImported`, `retainPlacement`, and lease route against the table above. Identify the concrete holder of detached and pending obligations. Preserve the public raw-result contract and defer public disposal.
2. **Introduce balanced retention at common boundaries.** Cover ready delivery, pending capture/publication, recovery, entry, method results, and existing readers. Prefer the established lease and operation-release mechanisms; store pending obligations on the existing capture/version work that owns them.
3. **Derive COW from authoritative facts.** Connect initialized incoming relationships, counted retained uses, import protection, and the selected mutation path. Preserve isolation of native receiver graphs and Array backing. Keep reuse proofs local and conservative.
4. **Remove the superseded protocol.** Delete `shared`, `markShared`, and retained-version behavior whose only purpose was permanent sharing, replacing each with its specified responsibility. Preserve version publication authority and pending dependencies. Temporary migration checks may compare protection decisions, but two authoritative ownership paths must not remain in the completed implementation.
5. **Validate release and reuse together.** Show both that surviving values remain protected and that releasing a known extra use can restore eligibility where the mutation and representation otherwise permit reuse. Update the ownership contracts and integration documentation with the implemented lifecycle, rather than leaving the permanent-sharing description authoritative.

The main integration points are [metadata and leases](../src/meta.js), [Chain holders](../src/chain.js), [lookup](../src/observations.js), [placement retention and publication](../src/property-versions.js), [import](../src/import-processing.js), [mutation work](../src/mutations.js), and the existing [Array representation](array-view.md). Unzipping and export will use these ownership rules rather than introduce separate protection systems.

### 5. Verification and completion criteria

Use public-operation sequences with an independent model of retained logical values and explicit holder lifetimes. Tests must prove values, effects, and identity behavior under supported interleavings; selected work measurements establish that improved precision actually avoids unnecessary copying.

Required coverage includes:

- Two Chains retaining a branch, replacing either root, and mutating the survivor. Show reuse for graph-only ownership when otherwise permitted, and continued protection when a raw lookup result also survives. Exercise explicit internal handoff separately from public assignment.
- A lookup result kept after source replacement or deletion; detached ready and pending captures; delivery after a different consumer closes; independent release of overlapping readers.
- Imported roots and descendants with one or no managed parents, plus runtime-owned copies that become eligible for reuse after their last extra retained use ends.
- Shared ancestors with singly parented descendants; multiple keys, cycles, private native aliases, and COW child reuse. Protection timing must not select different language alias semantics.
- Recovery across failure and repair; publication failure; independent method-result and receiver completion; source retention for future no-op comparison.
- Array backing shared by differently bounded views, overlays and repeated elements, materialization, and release of one holder while another still uses the old view. Ownership checks must not scan the full backing or allocate all parent placements merely to find a conflict.
- Balanced bounded acquisition, transfer, and idempotent release across synchronous and Promise paths, local closure, and fatal resumption. Open-ended public result retention must survive producer closure. Existing fatal handling must not acquire a new execution-wide cleanup registry.

Completion requires removal of the permanent sharing flag, maintained protection for every supported surviving use under the explicit lifetime rules above, demonstrated reuse after known internal releases or graph-edge removal, and the relevant sequence-model, storage, and refcount checks at the scales required by the [test guide](../test/README.md). Complete reclamation and bounded lifetimes for raw public results are not acceptance conditions. No runtime tests have been run to validate this unimplemented plan.

## Phase 3: Unzip unchanged mutation copies

**Status: design ready for implementation after phases 1 and 2; runtime implementation and integrated verification remain outstanding.** Use controlled mutation outcomes, counted activity, and retained originals to prove reuse. An effective mutation permanently breaks its affected reuse connection; subsequent convergence does not restore it. Arbitrary native receiver no-op comparison is deferred. Phase 4 consumes these identity decisions through common export and other identity consumers.

### 1. Principles and scope

A copied container starts with its source's logical placements, structure, and captured earlier publication dependencies. Preserve that baseline, account for work introduced through the copy, and restore the original when that work has proved unchanged. Run this mechanism without requiring an export. Phase 4 will use the resulting identity decisions for representations retained outside current placements.

Three facts have different responsibilities:

- **Incoming placements and retention** determine whether a new mutation may reuse storage.
- **Mutation activity** determines whether the relevant captured work has finished. It records no historical change total.
- **A surviving copy/source connection** establishes that no effective mutation belonging to that candidate has disqualified reuse.

An intact connection and completed required activity supply the proof. Zero counters alone do not establish equality. The proof does not depend on the original still having the parent count or reader lease that first caused copying.

The unit of change is a semantic mutation command at its ordered baseline. Same-value assignment, absent deletion, unchanged repair, and entry without effective commands remain no-ops. Separate effective commands do not become a no-op merely because they restore earlier contents. Entry preserves its contained command boundaries rather than comparing the whole interval against its initial value. Fresh equal objects remain distinct; this is not structural interning.

Controlled Array operations remain in scope. They must establish their complete logical effect through their existing range/remap work. Arbitrary native method bodies cannot yet supply this local change accounting and are outside this implementation slice; do not silently classify them as unchanged. Their existing publication and isolation contracts remain in force. Their pending publication still participates in a subsequently captured baseline: deferring native no-op classification does not omit its ordering or retention obligations.

The target alias rule is **path-local replacement for effective controlled writes**. If `root.a` and `root.b` refer to the same `{ k: 1 }`, assigning `root.a.k = 2` leaves `root.b.k === 1`; assigning the existing `1` preserves their logical identity. For `O.self === O`, an effective write to `O.k` produces successor `C` whose off-path `self` still denotes `O`: `C.self !== C`, while `C.self.self === C.self`. A no-op preserves the original self-cycle. Finite repeated path occurrences remain distinct mutation steps. These outcomes cannot depend on import status, lease timing, or whether storage happens to be reused. Phase 2 may authorize in-place storage reuse only when it preserves this result and every surviving capture; ambiguous aliases require copying.

Assignment links its captured right-hand value; it does not deep-copy or structurally intern that value. A managed native method instead mutates its completely isolated receiver graph using ordinary JavaScript alias semantics. Preserve that distinction and the existing external mutation authority. Representation-only copies preserve logical identity, while newly constructed language results and mutable-external snapshots are new identities even when their contents or backing match another value.

Entry preserves semantic command boundaries. Two effective commands `k = 2; k = 1` remain two changes inside leaf, enclosing, or nested entry; an enclosing protection copy must not restore the initial alias merely because its final leaf contents match. Propagate each command's resulting generation through the captured ancestor/publication path. Entry completion forwards that result without another interval-wide equality test. These target alias rules are an explicit semantic requirement for this phase and must be recorded in the runtime contract when implemented.

### 2. Capture and protect a fixed baseline

During path traversal, preserve the ordered array of actual `{ original, copy }` pairs. Record finite path occurrences even when the same original occurs more than once through a cycle. The stored path locates this mutation's contributions; phase 1's incoming index locates current destinations for substitution.

For every actual copy:

1. Acquire retention for its original before copying or exposing the destination. Reuse an existing acquisition only when its owner guarantees the complete required lifetime; another reader's current lease or today's parent count is insufficient.
2. Copy logical placement captures and structure through the existing property-version machinery. Earlier unavailable values and mutations remain represented by their captured versions.
3. Capture the original's existing mutation publication frontier once. If it is pending, register one inherited publication contribution on the copy before exposure. Forward completion of those effects, without forwarding their changed/no-op outcomes or identity-only waits into the new reuse connection. Capture the source's identity decision separately.
4. Establish the copy/source connection and register the new operation's own activity on its working path nodes before that operation can suspend, publish, or call out.

Choose the working container through the ownership/COW rule before charging a new mutation to it. Reading or copying an original does not register this later mutation as a writer of that original. The original's retention forces later operations to obtain their own copies, so they cannot join the captured source activity.

Retaining a baseline preserves its logical generation, not every byte of its current physical cache. Earlier transitions already captured in it can still publish through their authorized versions. A lease never waits for or blocks those producers. A new later mutation cannot overwrite that baseline.

The copy's captured outcome follows phase 2's ordinary ownership rules too. A later capture or another copy retaining it establishes protection before subsequent writers proceed. No later write may modify an earlier captured result, reopen a finalized identity decision, or join an earlier operation's completion dependency merely because storage addresses coincide.

### 3. Count readiness; attribute changes to their owning work

Each working node has an active count maintained by the common mutation subsystem. Two kinds of contribution use the same completion bookkeeping:

| Contribution | Registration | Completion |
| --- | --- | --- |
| Own mutation work | The operation records a contribution on each working path occurrence it can change, before suspension or exposure. An open mutating entry retains the contribution needed for its captured publication interval. | Finish required publication and the local outcome proof still needed by eligible connections. An effective outcome retires affected connections. Discharge each contribution exactly once when those responsibilities finish. |
| Inherited publication | Copy construction captures the original's existing unfinished mutation publications. It does not copy the numeric counter or subscribe to later source activity. | Discharge the inherited contribution when that captured publication frontier completes. The source operation's effective outcome and identity-only waits do not become this copy's own change or classification work. |

Inherited publication may itself include an earlier inherited contribution. This carries publication through successive copies without enumerating descendants again. Build its fixed frontier from already registered mutation/publication dependencies, including an open entry's promised publication. Never discover it by scanning graph data, and never subscribe to a future activity interval. Already-issued contained work belongs to the enclosing entry's publication responsibility; later outside operations do not.

The common activity record must expose publication readiness separately from its all-activity idle notification. The former joins only the captured producers' publication signals; the latter also covers still-required local no-op proofs. These are different conditions, so a single undifferentiated completion Promise is insufficient. Derive the publication frontier from the recorded contributions and existing gates; no second scheduler or whole-graph barrier is needed. Completion latches, later intervals do not reset a captured signal, and ready captures allocate no notification state.

Change propagation follows the contributing operation's recorded path and publication relationships. It never walks every later copy of an original. If an earlier operation changes `original`, it can retire `original`'s own older connection. A later `copy -> original` connection whose baseline already includes that operation survives when the copy's own work is unchanged.

For example, an earlier entered operation will set `original.k = 1` but is still pending. A later command copies that container and also assigns `k = 1`. Its conflicting write waits through the inherited property transition. The earlier operation makes the shared baseline `1`; the later assignment is a no-op against that baseline. The copy's inherited and own contributions both discharge, permitting reuse. Settling the earlier operation before copy creation must give the same result.

Full activity completion means required logical publication and still-needed outcome classification have finished. Publication can finish earlier. Assignment issuance, callback return, an independent result Promise, and physical cache synchronization are not interchangeable with either condition. An open entry cannot transiently appear complete between contained commands.

Ordinary pending data inherited by the identical capture is not an unfinished mutation contribution. If a local no-op decision needs an overwritten pending value, keep that decision pending on its exact captured dependency while an eligible connection still needs the proof. Do not reread the live placement or wait for unrelated graph data. Required language consumption and Error handling retain their existing completion rules independently of this optional identity proof.

Local classification includes presence, primitive comparison with `Object.is`, captured managed identities, exact opaque/Error identities, recovery, record order, and Array length/holes as applicable to the command. Assigning absent `undefined` is a change. A failed or cancelled attempt is unchanged only when its actual publication preserves the baseline; poison, recovery, or structural changes count as effects. A new reference-changing mutation is not rescued by later structural convergence. Do not introduce a recursive graph-equivalence solver into this phase.

These are local outcome requirements, not permission to compare arbitrary fresh graphs. For controlled Arrays, classify the completed command's affected mapping and structure rather than counting intermediate implementation writes. Fuse required element checks with existing range/remap work where possible. A scalar counter cannot eliminate the element work intrinsically needed to establish an Array no-op.

The producer audit must cover each semantic route through those common outcomes:

| Route | Required classification and preserved work |
| --- | --- |
| Assignment, root replacement, deletion | Preserve destination/RHS validation and native-`then` safety. Distinguish absence from present `undefined`; preserve ordinary root deletion's `null` result and entered-property deletion semantics. |
| Repair and failure publication | Classify the actual poison, recovery, presence, and structure. Healthy repair can be unchanged; restoring a poisoned placement changes it. An independent result Error does not undo a successful receiver mutation. |
| Entry | Protection alone preserves values and structure, including unused unavailable/invalid suffixes. Classify contained commands individually. |
| Array length, `push`, `unshift`, `pop`, `shift` | Preserve length validation, growth/shrink ordering, holes, argument work, and independent removed results. Removing a hole from a nonempty Array still changes its length. |
| `splice`, `fill`, `copyWithin`, `reverse` | Classify the complete affected mapping, presence, values, and length. Filling a hole changes presence; overlap and scratch-copy order do not define the logical outcome. A new result Array stays a separate identity even if its receiver is unchanged. |
| `sort` | Perform required comparator/default-comparison work and validation before classifying the resulting mapping. A receiver no-op never suppresses callbacks or their failures. |
| Representation copying and native boundaries | Preserve identity for pure representation copies. Keep native receiver isolation and external effects intact; do not infer a native no-op or skip a setter/call because arguments appear equal. |

Classify only admitted logical data and already captured structural facts. Required fallible reflection retains its existing causal boundary; a later identity decision cannot introduce recoverable poison into an already ready publication. No-op proof work must neither inspect hidden external state nor widen external mutation authority.

### 4. Completion and backward unzipping

Use three completion conditions, each at its natural scope:

| Condition | What establishes it | Who waits for it |
| --- | --- | --- |
| Required publication | The command's authorized placements, structure, recovery, and promised effects have been published through existing gates. Published data may itself remain pending. | Later conflicting operations and value consumers, under their existing contracts. |
| Identity decision | An effective outcome selects a fresh identity, or all own work proves unchanged and selects the captured source identity. | Identity comparison and phase 4 deduplication. An effective decision does not wait for the source identity. |
| Physical reuse | The connection is eligible, own work is unchanged, inherited publication is complete, and original and copy activity are both zero. | The reuse component alone; this is not an additional public result gate. |

Report the actual published local outcome to the reuse component. If its proof is already available, perform publication, classification, and cleanup synchronously. Otherwise publish first, keep only the exact dependencies needed for classification, and resume through the existing guarded continuation machinery. Publish producers before waiting for consumers of their identities. A contained command never waits for its enclosing entry to close merely to publish or return its required result.

Each candidate has one monotone reuse state: **eligible**, **retired by an effect**, or **substituted**. Its identity decision is a separate single-assignment cell, because identity can be known before physical substitution. The transitions are:

- **Effective own outcome:** retire the affected connection permanently and resolve the current generation's decision to its own fresh key. Previously finalized generation decisions remain unchanged. Remove this candidate's interest in source identity and any remaining no-op comparisons. Keep publication work and comparisons still required by other eligible path nodes or an independently captured result. Discharge a contribution only after its publication and remaining proof responsibilities end.
- **All own outcomes unchanged:** forward the identity cell to the captured preceding/source cell. This forwarding can precede inherited publication completion; it is an identity answer, not evidence that values are ready. The connection stays eligible for physical reuse.
- **Physical eligibility reached:** walk the stored pairs from the leaf upward and substitute current placements as described below. Activity notifications retry the retained candidate even if the operation that originally created it has already returned. A retired ancestor does not erase an eligible child's retry responsibility.

A connection's baseline lease belongs to physical reuse, not to an identity cell forever. On retirement, first transfer any still-needed value protection to the actual publication/capture holder, then release the connection's lease and clear its source reference. On substitution, release it after the placement commits and handoffs. Captured source identity cells can survive without retaining original storage. A still-pending required producer keeps its own captured state; it must not keep an obsolete no-op comparison alive.

For example, let source `S` have published `x = 1`, while its no-op proof still waits to learn whether an overwritten old Promise also held `1`. A later copy `C` adds `y = 2`, proving its own effective change. `C` gets its own key immediately and has no identity dependency on that old Promise. If its required values are ready, export of `C` can complete. `S` and an earlier observer may still need the old proof. If instead `C` made only no-op changes, its identity continues to depend on `S`. Thus retirement drops a particular consumer's proof dependency, never the producer's shared settlement.

Closing obsolete proof work uses the existing local-owner/release pattern. Pending reactions may remain attached to their signals, but refer only to a small closed record whose operation-only captures and leases have been cleared. They do no further proof work on resumption. Do not cancel source Promises, settle unrelated gates, add a global cancellation registry, or suppress required failure/publication processing. Releasing one candidate's interest is insufficient when another surviving consumer needs the same proof.

For each eligible copy, snapshot `getParentPlacements(copy, operationContext)`. Through one common equivalent-substitution transition, replace the copy with the original in every current placement that still holds it under the installed publication authority. Revalidate after any suspension. Do not restore an obsolete root or replay the original mutation path's old writeback.

Substitution must:

- Remove each substituted incoming placement from the copy and add it to the original through common bookkeeping.
- Preserve current presence, recovery, key order, Array shape, installed version, and producer responsibilities.
- Maintain the existing Promise/Error/cycle projection independently of the all-incoming index.
- Use ArrayView logical placements and overlays rather than modifying shared backing slots directly.
- Add no semantic mutation contribution or new change outcome: the transition substitutes an equivalent representation.

Keep source retention through substitution. There must be no suspension or user callback between the final authority check and each logical commit. Prepare required facts through the ordinary captured/publication machinery; successful cleanup cannot depend on new fallible graph discovery or create new language poison. Optional physical cache writeback may be omitted in favor of authoritative logical state.

Restore an unchanged child even when its parent has changed or remains active for other work. Stop upward replacement at that parent without losing the completed child substitution. An active eligible parent retains a retry on the relevant captured idle signal; a changed parent does not. After all required substitutions and handoffs, release only this work's source retention. The restored original is protected by its resulting placements and other holders; it need not remain permanently shared.

### 5. Encapsulation and lifetime

Keep the implementation behind a small internal reuse component. Common path copying reports source/copy pairs, mutation path work registers its working nodes, and common publication supplies completed local outcomes. These integrations must not expose counter arithmetic, source leases, inherited-work callbacks, or parent enumeration to individual command implementations.

The component owns:

- Source retention, eligible connections, and the finite recorded path.
- Own activity, inherited publication, separately captured identity decisions, and backward progress.
- Final identity decisions and handoff to common equivalent substitution.
- Idempotent release after the last required publication or capture use.

Keep the integration surface to four responsibilities: register working-path activity and actual copy pairs; report publication and controlled local outcomes; capture publication/identity readiness for a new consumer; and perform common equivalent substitution. One completion report may satisfy both publication and classification in the ready case. Individual commands do not enumerate parents or manage leases, counters, identity keys, or retry callbacks.

Do not add a global mutation registry, per-original lists whose counters every mutation must update, historical change totals, or another scheduler. Reuse phase 2 retention and existing property-version continuation/lifetime mechanisms. Inherited publication completion needs no outcome payload and cannot accidentally propagate the source command's change classification into the new candidate.

A copy can outlive its removal from all current placements. Retained lookup results, detached versions, other source/copy pairs, Array backing users, and staged exports keep their own ordinary protection. Do not erase its maintained outgoing relationships, cancel shared settlement, or permit later writes merely because its incoming set becomes empty.

Persist the captured identity outcome on surviving representations: an effective candidate keeps its own identity; an unchanged candidate adopts its captured source identity. A key is an opaque identity token, not the original object or its current metadata. Forwarding goes to an already captured generation's decision; logical graph cycles do not create identity-decision edges back to a newly created copy. Do not turn reference-changing writes into recursive structural-equality proofs.

Storage reuse must also respect generation changes after unzipping. Suppose a retained copy `C` and restored original `S` have the same key, and all of `S`'s extra protections later end. A subsequent effective in-place mutation of `S` must select a fresh key; `C` keeps the old captured decision. Start a new decision for that mutation interval, retain the preceding decision for a no-op outcome, and select a fresh token on the first effective outcome. This applies even when no physical COW occurs, or an older physical reuse attempt is still waiting for inherited publication. A later effect retires that older physical connection without changing its already finalized identity answer. Captures fix their generation before later mutation, and neither a later interval nor a later metadata lookup may reopen or reinterpret that answer. This small generation rule prevents phase 4 from merging a retained old representative with changed reused storage.

The original storage can retire after its value-bearing uses end. Phase 4 consumes captured identity cells/keys together with its independently captured values; it neither follows mutable source pointers nor waits for physical unzipping. A retired physical representative installed later through an independent retained reference need not recover the oldest JavaScript address.

This phase does not implement export assembly or arbitrary native receiver comparison. Keep both extensions behind the same ownership, publication, and identity boundaries rather than adding a native-specific path to this counter implementation.

### 6. Implementation and verification

Implement and validate the connected mechanism in these steps:

1. Add activity registration and fixed publication-frontier capture at common mutation path/publication boundaries. Keep publication, identity decisions, and physical idle notification distinct. Verify ready work and early issuance separately from required publication.
2. Record source/copy pairs and acquire baseline retention at common copy construction. Forward earlier publication as an inherited contribution; capture source identity separately. Never forward the source command's change outcome into the new connection.
3. Supply controlled local no-op/effective outcomes, including Array structural effects and failure/recovery publication. Propagate them through the recorded operation path.
4. Add all-current-placement equivalent substitution, using phase 1's parent API and existing version authority. Publish stable identity decisions and release retention at last use.
5. Integrate nested entry and consumer lifetimes, then run the relevant sequence models, storage/refcount verifiers, and checks described in the [test guide](../test/README.md).

Required verification includes:

- Multiple concurrent no-ops; mixed no-op/effective outcomes; later restoration that must not revive a retired connection; and a new copy made after earlier effective mutations have completed.
- A copy created while earlier work is pending on the same property or a sibling, with that work either unchanged or effective. Include successive copies inheriting readiness and every relevant settlement order. Compare with the fully ready execution.
- An external reader lease ending, or a source losing a parent through COW/deletion, while reuse remains pending. A later source mutation must copy elsewhere while the candidate's retention survives.
- Own contributions registered on the chosen working node, rather than on an original merely read during COW. Ensure no self-wait, producer/consumer wait cycle, or entry waiting on its own finalization is introduced.
- Same-value writes, absent deletion, repair, Error/recovery outcomes, signed zero, `NaN`, absent versus present `undefined`, and distinct fresh reference values.
- Controlled Array length, holes, endpoint operations and remaps, plus projected backing/overlays. Required callbacks and independent result values must survive receiver no-ops.
- Repeated path occurrences through cycles, multiple parents and keys, Chain roots, stale destinations, and unchanged children inside changed or active parents.
- Retained copies and identities surviving unzip; a later effective in-place write to the restored original must obtain a different identity, while a later no-op retains its preceding identity.
- A source's identity-only proof remaining pending after its publication is complete. An effective derived copy drops that dependency, releases an otherwise unneeded source lease, and can export without it; an unchanged copy still follows the source decision. Include a later no-op copy of the effective copy so the discarded wait cannot reappear through inheritance.
- Pending shared publication after one local consumer closes; source retention transferred to a surviving value capture when a connection retires; comparisons still needed by other eligible path nodes; and fatal resumption. An obsolete reaction must retain no released operation-only graph state.
- Work bounded to existing copies, operation paths, captured readiness dependencies, affected mutation ranges, and enumerated parent placements. No whole-container recheck solely to rediscover a controlled no-op.

The ownership, handoff, and completion decisions needed to implement this phase are specified here and in phase 2. Completion requires correct reuse under dynamic ownership, ready/pending equivalence, stable captured identities, and balanced required lifetimes. Design readiness is not an implementation proof: run the stated integration checks before claiming conformance. Public lifetime APIs, arbitrary native no-op comparison, and phase 4 export assembly remain outside this phase.

## Phase 4: Deduplicate export and unify identity consumers

**Status: planned; depends on phases 1–3.** This phase carries forward the export and identity-consumer work from former phase 9F-D, using phase 3's selected mutation accounting. It does not restore exhaustive copy/source comparison or native no-op detection. Runtime implementation and integrated verification remain outstanding.

### 1. Purpose and identity contract

Unzipping updates current graph placements. It cannot redirect a raw reference or an export capture that already retained the copied representation. Export therefore needs a second step: assemble those captured representations according to their final logical identities. Both steps use phase 3's decisions; export supplies no competing equality test.

One boundary treats all its ordered roots as one graph. Equal final identity keys select one output object across that graph, including cross-argument references, aliases, and cycles. Different keys stay distinct even when contents are equal. Separate export calls produce independent host copies and promise no JavaScript address equality between those calls. Keys are execution-local; managed values cross executions only through export then import.

Mutation publication and identity classification supply export's required decisions. Physical unzipping is attempted as those decisions permit, but its cleanup is not an extra export gate. Capture and private staging can progress while earlier mutation work remains pending. Delivery waits for the required captured values, effects, Error collection, and identities, never for later mutations or unrelated branches.

### 2. Capture each generation before waiting

At the boundary's ordinary ordered capture point, capture every available placement and structural fact, retain exact pending versions, and traverse a newly delivered branch at its FIFO position. Preserve ready sibling capture; waiting for a whole branch before starting would allow later writes to change the requested snapshot.

Associate each captured representation/generation with its opaque identity decision immediately. A cache keyed solely by a JavaScript address is insufficient if that storage can later represent another generation. Use phase 2's capture-owned retention until the last source access, with delivery obligations established before suspension. Transfer those obligations before releasing a lease. Staged data and an identity token do not require retaining source storage after capture is complete.

Preserve existing structural capture for Array length and holes, record order, and admitted prototypes. Visit only language placements; keep Functions and observation-only external leaves exact and enforce existing mutable-capability escape restrictions. Do not revisit a live source after suspension or reflect on source objects during final assembly. A key match does not authorize skipping required reflection or Error collection for another captured representation.

### 3. One private assembly path

Use the same staging and assembly path for ready and pending decisions. Allocate a private output shell before descending into children so cycles can reference it. Record captured root and edge relationships alongside each shell's decision; no staged shell escapes early.

For successful output:

1. Finish required capture, value preparation, and Error collection under the existing export contract.
2. Resolve the captured decisions to final keys. Use completed answers immediately; wait only for still-required captured identity dependencies.
3. Build one `Map<finalKey, outputShell>` across all roots. Select one representative per key in stable capture order. The key proof guarantees equivalent logical contents and structure for every member.
4. Visit the staged output edges once and redirect each managed reference to its selected representative. Redirect every root position too. Cover duplicate shells, self-edges, spanning cycles, and cross-root aliases; updating the map alone cannot update already stored references.
5. Expose the complete output, then release duplicate shells and assembly-only records. No rewrite occurs after delivery.

The final pass reads private output or its captured edge records only. It performs no source reflection, host callback, graph mutation, or deep comparison. All-ready work completes synchronously through this path. Leaf-first traversal cannot order a cyclic graph and is unnecessary; shell allocation followed by complete reference wiring handles it directly.

The baseline resolves all staged managed identities before successful delivery, including an isolated candidate whose alias topology might not require that wait. This is a deliberate simple completion rule. A changed candidate already has its own key and therefore never waits for a retired source proof. A no-op candidate can still depend on an overwritten old value under phase 3. For example, if aliased branches both replace an old pending `k` with `1`, their final alias relationship depends on whether the old value was `1`; replacement data can be ready before that answer. An old Error consumed solely to classify that identity is not part of the replacement output's Error collection. Do not guess a distinct identity because an input is pending.

### 4. Shared identity access and encapsulation

Keep source links, activity counts, baseline leases, and outcome classification inside phase 3's reuse component. Export receives opaque capture/resolve/ready-read access to identity decisions and owns only its private shells, roots, edges, and final-key map. Existing callers continue to use common export entry points, including batch argument export. They do not acquire original maps, flags, or cleanup callbacks.

Other identity-sensitive consumers must use the same answer:

| Consumer | Responsibility |
| --- | --- |
| Lookup, assignment inputs, retained results, and Chain holders | Retain the captured generation under phase 2; later identity access must not reread current metadata for that storage. |
| `includes`, `indexOf`, `lastIndexOf` | Compare managed logical identities only where the search consumes them. Preserve each method's primitive equality, ranges, short-circuiting, and Error behavior. |
| Managed receiver preparation | Prepare required data with one representative per final identity, preserving receiver aliases and cycles. Native mutation then uses its existing isolated receiver semantics; comparing arbitrary native mutations for no-ops remains deferred. |
| Native arguments and controlled callbacks | Use common batch export so aliases spanning arguments survive. A repeatedly used prepared snapshot retains its own established lifetime. |
| ArrayView and remap construction | Preserve identities for representation copies. New language result containers and effective receiver generations keep distinct keys. Shared backing alone proves no identity equivalence. |
| Ready-only external property snapshots | Use only established required state and identity. An unresolved required decision follows the existing snapshot-failure contract, without waiting or subscribing. |
| Error queries and graph indexes | Follow logical placements and maintained dependencies. Do not introduce identity waits irrelevant to their result. |

Identity-sensitive work inside an entry consumes its ordered private view. It must not wait for that same entry's future closure; outside publication-following captures still include the entry's promised commands. Do not use native `===` on internal storage as the managed identity operation.

### 5. Output lifetime, failure, and work bounds

Discovering an output Error discards private shells and identity-only assembly dependencies. Required Error collection continues with existing cause/context/kind membership and source attribution. Do not wait for an identity that can no longer affect the failed output, and do not cancel its shared producer. Output lifetime remains separate from its containing operation's lifetime.

Use existing guarded continuations and local release hooks. In a live execution, shared settlement and index publication occur before a closed consumer skips its work. On success, Error discard, or local closure, release output-only maps, captures, shells, and subscriptions' retained payload at last use. Fatal resumption stops before shared settlement; existing outward result handling owns fatal delivery. Add no execution registry, cancellation sweep, late poison lane, or output-specific scheduler. Unexpected trusted identity/assembly failure is fatal.

For `V` staged representations, `E` staged edges/root positions, and `D` captured identity dependencies, target expected `O(V + E + D)` assembly and decision propagation using maps and one-time decision resolution. Resolve and release completed forwarding records so final keys retain neither ancestry nor original storage. This bound excludes existing capture, Array-range, mutation, incoming-placement substitution, and Error-processing costs. Measure those separately; no all-pairs candidate buckets or source graph rescans are needed.

### 6. Implementation and verification

First connect one complete path through actual controlled mutation classification, all-placement unzipping, a retained copy, and export captured before completion. Include two effective commands inside transparent entry and a no-op cycle. Then integrate batch export, searches, receiver preparation, Array representations, and ready-only snapshots through the same opaque identity surface. Remove superseded physical-address identity assumptions as each consumer migrates.

The acceptance matrix includes:

- Aliased and cyclic records/Arrays exported before, during, and after pending entry; direct versus leaf, enclosing, and nested entry; same-value assignments, skipped commands, and finite repeated cyclic path occurrences.
- Effective controlled writes on runtime-owned, imported, and leased aliases with the same expected path-local graph, including ready, synchronous custom, and delayed observations. Independent effective writes and fresh equal objects remain distinct.
- Out-of-range Array entry that performs no write; explicit create/delete that preserves a grown length and hole; deletion/reinsertion that changes record order. No-op detection cannot erase these structural distinctions.
- Multiple copies and copies of copies, all roots and cycle edges wired before delivery, batch arguments sharing children, sparse Arrays, managed prototypes, Functions, and exact external leaves.
- A saved copy first exported after its source connection retires, and a restored original later changed in place. Captured old keys remain stable and must not merge with the changed generation.
- Export capture followed by sibling writes, root replacement, source-lease release, parent attachment/deletion, detached publication, and nested work outliving an entry callback. Ready siblings retain their earlier values; no obsolete writeback regains authority.
- Overwritten pending values equal to or different from the replacement, rejection, never-settling identity-only inputs, and an effective descendant that makes a source proof irrelevant. Ready replacement data and unrelated work remain available.
- Identity searches and prepared managed receivers agree with export. No consumer waits on its own entry completion or later conflicting work. Ready-only snapshots retain their failure and no-subscription behavior.
- Error discard followed by late required Errors, supported reflection/storage failure, independent result/publication Errors, local closure, and fatal resumption. Closed output never restarts or releases another holder's protection.
- Repeated operations with retained-state and allocation measurements; coherent incoming and refcount indexes; one assembler for ready/pending results and unchanged caller APIs.

Extend the existing models and verifiers in the [test guide](../test/README.md). Use independently specified graph values and alias partitions as the oracle; do not adopt one timing's current runtime result as the expected semantics. Standalone comparison/assembly prototypes from the superseded design are not conformance tests. Completion requires the connected runtime mechanism and all identity consumers to pass together. Update [outbound export](outbound-export.md), [managed invocation](managed-invocation.md), [ArrayView](array-view.md), and the semantic contracts to describe implemented behavior.

## Phase 5: Support Promise-valued path segments

**Status: planned; migrated from former phase 10.** Preserve the design and verification below, including its explicit prefix-to-target ordering evaluation.

Implement [Promise-valued paths](promise-path-segments.md) through the existing observation and mutation walkers using Phase 9F-B's shared placement and capture-ownership contracts. Use explicit observation capture where protection must precede publication, and plain captured continuations for non-retaining work; do not infer that choice from an operation owner. Preserve complete presence/recovery through shared capture and publication primitives. Managed paths and observation-only external paths support dynamic inputs. Mutable external resources require static selection; only their already-selected native suffix can contain dynamic input keys. This phase adds no candidate-resource reservations.

### 1. Consume segments at their logical position

- Normalize each reached String/Number segment exactly once. Consume supported thenables through the common guarded helper before normalization; a synchronous custom delivery continues immediately. A ready PoisonedValue supplies its original Error through the ordinary rejection callback.
- A raw ready or rejected segment failure uses PathSegmentFailed; a resolved non-String/Number value uses InvalidPathSegment. Preserve already-contextualized poison and fatal classification. Do not coerce unsupported values or stringify Promise objects.
- Stop at a failed prefix before consuming unused segments. Unconsumed Promises remain host-owned; do not observe rejection solely to suppress host reporting.
- Carry the path's firstDynamicSegment compiler fact through capture, composition, and entry. It describes source selection, not current readiness. A computed ready String does not become a static mutable-resource route.
- Initial discovery filters only the compiler mutation access tree's static prefixes. An external owner reached before the first dynamic key is eligible; a managed endpoint requests no descendant search. Promise-valued path support adds no leaves or late discovery.

### 2. Protect unfinished path selection once

Walk available segments synchronously. Initialize callback-visible staging, captured versions, and unconditional writeback before subscription. A custom callback may run before then returns. Only a returned pending chain while path selection remains unfinished installs pending-only protection before the issuing stack returns.

- An observation leases the longest reached managed prefix. Later managed mutation uses COW, preserving that captured value without blocking it.
- A mutation gates the reached managed prefix and continues against its private value. If the prefix covers registered locations, establish its external ordering position before publishing that gate and before later operations issue. Implement the handoff to a selected target without acquiring behind later statically reserved work. Evaluate reusing ordinary gate/reservation transitions, preserving narrow sibling progress after selection; retain only an implementation that simplifies the combined ordering model. If preserving that progress needs new scheduling machinery, discuss the smallest semantic restriction before adopting it. Do not reserve guessed native child candidates or treat entry-lifetime membership alone as an ordering position.
- If a static prefix already selected one mutable external boundary, reserve its ordinary phase before waiting for native-suffix input keys. No managed COW or per-property gate is installed inside native storage.
- An observation-only external identity needs no mutation lock or fixed namespace.

Retain one pathSelectionComplete fact, set immediately before handing the selected target to its operation. A pending independent target result does not imply unfinished selection. Reuse one prefix lease/gate across later segments; a ready custom key followed by pop of a pending element must leave the completed Array mutation visible immediately and add no prefix protection for that removed result.

Reuse captured versions and FIFO continuations. Do not add callback-ran flags, a second result algebra, temporary Chains, a new path scheduler, or a second receiver gate. A coarser gate can carry final publication but does not broaden the selected semantic poison scope.

### 3. Reject dynamic mutable-resource selection deterministically

- A dynamic source key before a reached mutable boundary is an invalid external route, including when its current value is ready. Use ExternalLocationConflict with a static-path diagnostic. Fail before native reflection, capability extraction, or external phase reservation.
- Observation returns its local Error. Mutation publishes at an explicit managed scope already selected before the dynamic key; when its intended scope lies beyond the key, use the longest static managed prefix. Capture this fallback location from path facts before waiting, and publish through the existing mutation transition. Never poison a guessed leaf or all resources beneath the prefix.
- Detection time may depend on path readiness; Error location does not. A poisoned prefix returns its original Error before any new validation or unused segment work.
- Dynamic paths selecting ordinary managed or observation-only external data remain supported even when their shared prefix also contains a registered mutable sibling. No blanket rejection of a mixed managed prefix is allowed.
- A dynamic key within an unregistered suffix remains valid, but cannot select or cross a registered descendant without static provenance. Stored native intermediate values, receivers, and callables must be ready; only final lookup values or direct call results consume availability. Final assignment/deletion does not read the old target.
- Entry follows Phase 9F-C's transparent runtime anchoring. Preserve the requested reference and source provenance while protecting its available enclosing placement or registered external scope. Unavailable or invalid application suffixes are consumed only by actual contained commands; no-op entry must not subscribe to unused Promise segments or publish their validation failures. A pending transition still orders conflicting work. Rebasing cannot grant static authority, and the compiler performs no host-category-dependent entry selection.

### 4. Reuse the operation lifetime and publication boundary

A path component reuses its containing query, export, invocation, or entry owner. Standalone lookup, mutation, and repair obtain one OperationOwner through one centralized provision point. The allocation point may be eager or first-pending, but optional-owner branches must not spread through walkers. Preserve Phase 9F-B's separation: capture semantics determine value retention, while common guarded continuations use the operation owner only for local-work lifetime. Version retention and publication never infer ownership from that owner's presence, type, or open state; no query-specific or path-specific version mode is added.

Every pending continuation uses common guarded helpers. In a live execution it finishes required shared settlement before checking local closure; after closure it performs no key normalization, traversal, lease/gate acquisition, native access, publication, or result work. Fatal resumption stops before shared settlement as usual. Observe owned pending walker reactions at their originating layer even when a non-blocking mutation does not return them.

A mutation owner closes after its required gate publication, not its immediate issuance return. Repair closes after its selected scope transition. Read/export/query source protection ends only after final capture; export output keeps its separate lifetime. An independent result cannot extend completed receiver or path protection. A blocking scope ends action-only work without waiting for unused arguments, retaining owned rejection handling and shared settlement.

Repair selects managed placements through ordinary path resolution; registered external scopes additionally require static provenance. Preserve Phase 9F-A rollback baselines across pending path selection, including original placement presence and source versions. Repair exposes the selected managed baseline and clears covered external subtree poison before any call, bypassing no strict-ancestor own poison. It does not erase independent earlier managed failures, ordinary Error data, or permanent binding conflicts.

### Verification

- Exercise root, middle, and final native/custom Promise segments through lookup, lookupPathForExpression, assignment, deletion, run, export, hasError/getErrors, repair, and managed entry. Include ready custom fulfillment, synchronous PoisonedValue failure, pending rejection, unsupported resolved keys, and skipped unused suffixes.
- Extend the existing cross-operation checks in `test/operation-sequences.test.js`, `test/array-native-equivalence.test.js`, and `test/reflection-boundaries.test.js` with pending path selection. Preserve earlier export/query/method frontiers after a resolved child is replaced; compare Array observations across pending entry deletion and a later overwrite against native sequential results; inject supported reflection failures before and after selection resumes. Keep scenarios without extra diagnostic lookups, which could supply missing sharing protection, and verify maintained indexes with the existing refcount oracle. Reuse these suites rather than introducing a separate audit runner.
- Compare ready and pending equivalent paths for values, COW, scope poison location, and complete required Error membership. For expression extraction, ready failure returns its PoisonedValue while already-pending failure rejects with the ordinary Error.
- Test one prefix lease/gate across several pending segments, old-value capture under later mutation, Array views, aliases/cycles, imported/fixed versions, and a ready selected operation with an independent pending result.
- Dynamically select a mutable resource with a ready computed key and a pending key: both fail locally before native access with the same predetermined failure scope. Preserve the exact blocking poison and leave candidate resource phases untouched. Test explicit ancestor bang and default mutation scopes, regular-Chain aliases, and composed/entered provenance.
- Select a managed child or observation-only external sibling through those same dynamic prefixes successfully, without mutable-resource locks. Select a mutable owner statically and use pending suffix input keys under its one phase.
- Verify static discovery creates no candidate leaves from dynamic-only resource selection. A first external boundary found before a dynamic native suffix remains eligible. Context registration remains atomic and later fulfillment adds no authority.
- Enter a managed mixed target through a pending key, then issue a later static native access beneath its available enclosing anchor. Capture the initial external ordering position before later access and retain the pending suffix in the private reference; a no-op callback can finish without consuming the key. A contained command consumes it at its own operation context. Keep Phase 9F-C's single-path anchor fixed, preserve captured predecessors, and allow unrelated work outside its coverage to proceed without reservation/gate cycles. Reject any dynamically derived attempt to use a registered identity. Repeat within nested entries. Separately test the ordinary managed-mutation handoff to a non-resource sibling described above; coordination of multiple declared entry paths remains in Phase 7.
- Exercise closure before a later key resolves, shared settlement after local closure, fatality behind an unresolved key, and ownership of discarded pending reactions. No local closure releases another operation's gate or phase early.
- Cover complete contextual Error queries through static paths, terminal poisoned guards with hidden never-settling children, accessible sibling Errors, ancestor collection of external scope metadata, and old results after repair. No native properties are read to inspect scope poison.
- Ensure no provisional phase map, all-candidate wait, deferred candidate reservation, extra path queue, callback-readiness flag, or compatibility route remains.

## Phase 6: Review imported-Promise settlement ownership

**Status: planned preservation check; migrated from former phase 11.** Run after the preceding ownership, identity, and Promise-path changes. No production rewrite is planned without a demonstrated defect.

### Problem

The import processor owns segment processing, validation, staging, and abandonment for synchronous and pending custom delivery. It uses the shared placement mechanics established by Phase 9F-B without an installer callback or property-to-import delegation loop. Mutable-authority discovery independently follows Phase 9E's directly accessible source rule.

### Outcome

This phase is a preservation check after Phase 9F-B consolidation and Phase 5 Promise-path changes, with no further production rewrite planned. Verify the resulting processor against the constraints below. The bounded lifecycle evaluation belongs to Phase 9F-B; do not repeat it here or reopen the importer without a newly demonstrated defect or duplicated responsibility.

### Constraints

- Preserve one atomic staged import walk per synchronous segment. A failed segment commits no admissions, origins, retentions, pending Promise placements, fixed imported logical versions, or external-tree leaves.
- Synchronous custom delivery continues the active segment and identity map. Later delivery for a committed placement starts a fresh segment at its existing FIFO position and retains its originating boundary context. An abandoned segment's callbacks retain no import or publication authority.
- Keep external-tree discovery as a separate occurrence walk because it must preserve finite alias paths; commit it atomically with identity admission.
- Reuse placement versions and the existing Promise version. Add no `ImportTransaction`, second overlay store, or parallel continuation path.
- Make no change merely to move code between files. A neutral or larger conceptual result is a failed experiment and must be reverted.

### Verification

- Ready and Promise-fulfilled imports preserve the same admission, attribution, alias, cycle, placement-version, and tree-discovery behavior.
- Failed fulfillment segments leave no partial state.
- The importer still owns raw-input subscription, fulfillment-segment processing, and import policy; shared placement code owns capture, construction, producer tracking, and commits of complete prepared logical state. Ordinary consumption must not admit data ahead of segment validation. Borrowed transition projection continues through result validation, including after copies or repair. No installer callbacks, import-policy forwarding, property-to-import delegation loop, or duplicate processor have returned.

Keep [`import-processing.md`](import-processing.md) aligned with the retained Phase 9F-B boundary; update it here only if a newly justified change is retained.

## Phase 7: Cut Cascada over to the execution Error architecture

**Status: planned cross-repository integration; migrated from former phase 13.** Preserve the complete compiler/runtime cutover, batch-entry, diagnostics, and iterator-finalization requirements below. This migration does not implement or redesign Cascada expressions here.

### Problem

The kernel phases establish the final Error semantics, but Cascada currently owns per-render reporting, root fatal racing, compact source formatting, `RuntimeError`, `RuntimeContextError`, `PoisonedValue`, `PoisonErrorGroup`, `RuntimePromise`, sync-first Promise-like values, legacy kind names, and compiler/runtime helpers that encode the previous transport model. Scattered documentation-update bullets do not provide an end-to-end migration or prove that the final script result, diagnostics, thenable ordering, and browser/runtime support use the kernel architecture without adapters.

### Outcome

Move Cascada to the kernel's Error and execution contracts in one explicit integration phase. Preserve Cascada's useful per-render reporting, compact diagnostic context, bounded formatting, result-driven root completion, and ordered sync-first continuation behavior while removing duplicate Error representations, fatal state, attribution, and Promise paths.

### 1. Integrate execution-owned fatal handling

- Create one `Execution` for each render/run and pass that render's `onError` as its immutable reporter. Concurrent executions with different reporters must not cross-route failures.
- Replace the compiler's error-context-only data flow with an explicit render-local operation-context table. The generated `getErrorContexts`/`prepareErrorContexts` path currently creates one compact tuple per static source entry for each render; change that setup to pair each immutable source handle with the current render's `Execution` once and expose the resulting immutable `{ execution, errorContext }` entries to generated code. Every emitted graph call and command stores or passes its selected operation context directly. It must not recover execution through a diagnostic tuple, a Chain, ambient state, or a later consumer.
- Reuse one operation-context object for repeated execution of the same exact prepared source handle within one render, so ordinary loops and repeated commands do not allocate a two-field record per invocation. Distinct compiler source handles remain distinct even when they share a line, and a dynamically derived immutable diagnostic handle receives its own operation context. Reuse intentionally allows repeated failures with the same cause and kind at that source to merge in collection; collection counts unique semantic failures, not invocations. Runtime-created nested operations reuse the current execution but use the source handle for the operation they actually perform. Prepare derived contexts when a distinct diagnostic route is created, as specified in section 4, without adding mutable operation state to the carrier or allocating fresh handles solely to defeat deduplication.
- Treat the Chain/operation-context pairing as trusted compiler/runtime protocol. Scripts cannot supply it directly; verify that compiler lowering passes the required operation context through all routes rather than adding defensive checks to every generated command and helper. A malformed root integration call throws an ordinary programming error and creates no fatal state or fallback execution. A cross-execution Chain binding or closed entered Chain with a supplied valid operation context deliberately fails that execution before graph access. A future host API may validate its own application inputs but must not add another execution-selection path.
- Make `RenderState`, command buffers, iterators, child buffers, and the scheduler check the execution's `fatalError` at their existing entry, resumption, and dispatch boundaries. Every execution-bound operation passes its classified direct result through the common sync-first `returnOperationResult` helper; only an actually pending operation result registers one removable outward reject action. Replace `raceRootResult` with that general helper and remove its extra rejection-classification catch because operation results are already classified. Remove duplicate fatal Booleans/latches, report idempotence, and candidate selection after all consumers use the execution outcome.
- Remove `RenderState`'s eagerly allocated fatal Promise and its no-op observer. Store only the reject actions of operation results that are currently pending and delete each on normal settlement; a ready-only render allocates no wrapper or registration, and a long-lived successful render retains no historical losing-race reactions.
- Do not preserve `raceRootResult`'s independent `.then` policy or its conversion of an already-failed ready call into `Promise.reject`. The facade helper preserves Error, Function, and fixed admitted-category precedence before ordinary supported thenability, shares the kernel's one continuation path, and throws an already-present `fatalError` synchronously.
- Replace Cascada's `RuntimeError.report`, `RuntimeError.reportAndThrow`, `reportRuntimeContractError`, `createSyncRuntimeError`, `RenderState.reportFatalError`, `RenderState.reportAndThrowFatalError`, and context-keyed fatal adapters according to scope. Execution-bound runtime defects use the kernel's `FatalError` through `failExecution` or observe the execution's existing outcome. Compilation, loading, configuration, and malformed root integration calls outside a render propagate ordinary synchronous programming exceptions and construct no `FatalError`. Do not leave a `RuntimeError` compatibility alias, generic fatal factory for failures outside execution, or competing reporter path. In particular, delete Cascada's no-callback `report(error)` fallback that throws asynchronously: the captured reporter is notification only, and fatal control transfer comes from the detecting call, a pending outward result, a later public-entry check, or `execution.fatalError`.
- Use the same `returnOperationResult` helper for script completion and every other execution-bound public operation. First produce the script result through common export; do not expose a raw managed lookup, a nested Promise container, or a fire-and-register issuance outcome as proof of work the script intends to include. Before final host delivery, convert an ordinary recoverable Error to rejecting expression/native transport after complete export. Public entry throws an existing `fatalError` synchronously; otherwise the operation performs its required boundary processing synchronously as far as possible. The already-classified result preserves Error, Function, and fixed admitted-category precedence before ordinary supported thenability. Return a ready result directly. For an actually pending direct native Promise or supported thenable, synchronously create the outward wrapper, register its idempotent reject action, attach source settlement through the common helper, and delete the action before normal resolution or rejection. Fatal commit rejects and clears the remaining actions. Do not add a second post-operation fatal check: a transition that detects fatality must submit and propagate it, while a later observer checks and returns. Once a result settles, deliver it without waiting for unrelated work. A later fatal is stored and reported by the execution and cannot change the delivered result. Contextless configuration calls remain synchronous and outside this mechanism.
- Use only the documented root package API completed in 9D-B. Graph operations keep their public result boundaries; Cascada does not import private implementations or retain an unwrapped-operation route. Use the same public Error factories, expression factory, guarded composition primitives, and fatal submission for work owned by Cascada. Each kernel call owns its pending API result. Each render with additional required work owns its separate final result once; delegating environment/top-level aliases and callback adapters consume that result without wrapping it again. Compiler commands and buffer lanes are internal scheduler work, not additional outward operations. Tests enforce this classification and reject imports from the removed integration subpath or private kernel files. Measure representative compiled render workloads using the [public-result cost acceptance criteria](first-principles-conformance-plan.md#public-result-cost-and-acceptance-criteria): report ready/pending mixes, dependent and branching work, native Promise allocation, peak pending obligations, and end-to-end latency. Compare only implementations preserving prompt fatal delivery and all required completion. If public-result ownership is a material cost, request an explicit architecture decision with the measurements and a concrete public composition proposal; do not restore private imports or silently weaken result guarantees.
- Keep operation owners local. Internal commands, scheduler waits, and guarded helper transitions register no outward result. Public kernel calls retain their own pending-result obligations, and a render with additional required work retains its own. Common resumptions stop after fatality.
- Delete Cascada's fatal broadcast/cancellation path: `_fatalAbortBroadcasted`, `_abortActiveLaneRuns`, fatal-only `CommandIterator.abort` and `ObserverState.abort`, and `_rejectPendingCommandResultsAfterFatal`. Replace `_throwIfFatalLaneAbandoned` and its callers with the ordinary execution check. Do not bulk-reject internal command results merely because the execution failed; an actually pending result exposed by a public operation already has its outward reject action, while purely internal waits stop if they resume.
- Do not cancel or specially settle native Promises, gates, phases, or synchronous external code. A never-resumed internal wait may remain pending without delaying any pending operation result. Section 3 defines the sole additional host-effect exception: local finalization of an iterator the operation already owns. It does not authorize command dispatch, graph transitions, phase/gate settlement, owner sweeps, or cancellation after fatal.

### 2. Replace the legacy recoverable representation

- Use the public kernel PoisonError, CompoundPoisonError, FatalError, Error factories, and separate PoisonedValue factory/predicate. Remove duplicate Cascada Error construction, grouping, wrapper, fatal, and recognition implementations after their callers use those facilities. Keep ordinary Errors inside operation Chains. Compiler lowering converts graph results to expression values only through lookupPathForExpression; expression-created failures use createPoisonedValue on an attributed ordinary Error. Remove compatibility names and markers rather than adapting their old shapes.
- Adopt the kernel's documented ordinary Promise and supported thenable contracts at Cascada integration boundaries. Preserve causal attribution at the producer and avoid a second subscriber queue or transport adapter. Cascada owns replacement of its expression Promise helpers; this project does not specify their internal design. IteratorWaitToken remains an internal scheduler token.
- Cascada consumes the public Error recognition/combination and input-boundary contracts. Kernel integration must preserve complete required Error membership and causal attribution; expression operand evaluation and collection implementation remain Cascada work. Use public getErrors for complete graph inspection and hasError for existence. A successful query yields ordinary data; QueryReflectionFailed remains a distinct failure. Diagnostic inspection returns null when healthy and a safe immutable view for poison. Do not duplicate kernel Error construction or diagnostic data contracts in an expression implementation.
- Map every old Error kind to the authoritative contract-based `ERROR_KIND` table. Treat `UserCallThrew` as a call-site split: selected external Function/method failures use `InvocationFailed`, while callbacks and comparators owned by controlled operations use `ControlledCallbackFailed`. Delete transport-named aliases in the same cutover rather than keeping compatibility kinds.
- Update compiler-generated catches and async boundaries. A language-outcome channel preserves expected poison; a callback, cleanup, scheduler, or bookkeeping transition whose contract admits no Error outcome is fatal-on-escape even when the escaped object is poison.
- Replace legitimate uses of legacy poison `finally` with ordinary local completion/cleanup control flow. Do not preserve `PoisonedValue`'s suppression of a failing finalizer or its thrown-poison conversion. A trusted live cleanup failure, including escaped poison, reaches the fatal envelope; section 3's already-fatal host iterator finalization is the separately specified exception.
- Replace Cascada's cause-only deduplication with the kernel's cause/context/kind equivalence in collection and compounds. Remove mandatory source sorting, logical child-order tests, primary-source guarantees, and stored `.kinds`. Derive diagnostic projections when needed; any sorting belongs to a separate view. Add no persistent Error cache or canonical wrapper registry.
- Remove copying of arbitrary enumerable cause properties and eager cause-stack reads during Error construction. Preserve the exact compliant cause reference under 9D-A's diagnostic-only payload contract. A safe language view uses only the hook-free summaries in section 4; a catch around arbitrary cause inspection is insufficient protection against re-entry or side effects.
- Move `didIterate` and every equivalent loop-progress fact off poison wrappers and leaves into the owning loop's operation-local state. Pass that state directly to failure handling; frozen Errors remain immutable semantic outcomes and never double as control-flow transport. Cover failure before the first iteration and after at least one iteration.
- Keep load-failure policy and discarded-expression Promise handling above the kernel. Cascada owns every Promise it creates and every kernel result it buffers, schedules, or discards instead of returning; attach handling at that exact producer, storage, or discard site. Do not introduce a generic fatal-versus-recoverable policy hook or recursively inspect discarded graph values.

Audit `runtime/call.js` (`callWrapAsyncInternal`, environment calls, and their wrappers), callback/extension dispatch, iterator acquisition/advancement/close, and render-owned loader hooks as host boundaries. Replacing their catches with factories is insufficient: prepare/export inputs, invoke only the exact external action through the shared envelope, check authoritative fatal state there, and perform result admission or fixed-kind rejection conversion in the existing guarded completion work. Keep compiler-generated macro/runtime callbacks in their declared trusted callback roles rather than treating every callable as external code. A host protocol result such as an iterator step record is validated/selected by that protocol before its language `value` enters admission; arbitrary protocol objects are not direct language results.

Remove the raw `.apply(executionContext, args)`/implicit `context.ctx` receiver path for standalone external Functions. A standalone host call uses `undefined` as its supplied `this`; code requiring the old context receives an explicitly declared receiver or argument exported through the common boundary before invocation. Document this API change and migrate built-in environment adapters at the same time. If an API explicitly declares a receiver, export its managed context snapshot alongside the explicit arguments, or select an exact external receiver through ordinary authority and phases. It must never expose a live unexported context by an implicit calling convention. Do not infer managed mutation or external authority from a external Function's use of `this`.

Apply 9D-A's diagnostic-only payload restriction to raw host returned Errors, throws, and rejections from these calls. Higher-runtime validation errors must contain safe facts, not context/receiver objects. Apply 9D-0's successful native `then` restriction to exact Functions, exact external values, exported context snapshots, and final render results. Preserve complete required input/export collection; callback and standalone-call adapters must not reintroduce fail-fast collection accidentally.

Audit the higher runtime against this exact causal inventory; existing poison reaching any row propagates unchanged, while only a raw failure caused by that row receives its kind and operation source:

| Cascada causal boundary | Kind |
| --- | --- |
| BigInt division or remainder by zero | `DivideByZero` |
| Requested binding absent after a successful module load | `ImportBindingMissing` |
| Operator operands violate that operator's supported type contract | `IncompatibleOperands` |
| Loop concurrency limit is outside the accepted numeric modes | `InvalidConcurrentLimit` |
| Value cannot be emitted by the text-output contract | `InvalidTextValue` |
| Iterator acquisition, advancement, yielded-value consumption, or required local close fails while execution is live | `IteratorFailed` |
| Import, include, or component loading fails under configured nonfatal load policy | `LoadFailed` |
| A numeric operation produces forbidden `NaN` | `NaNResult` |
| Value cannot satisfy the requested destructuring form | `NotDestructurable` |
| Value cannot satisfy the requested iteration or membership form | `NotIterable` |
| Lexical/context lookup cannot find the requested variable | `UnknownVariable` |

If a runtime feature no longer has one of these semantics, remove its kind from both this inventory and the authoritative table instead of retaining an unused compatibility value.

### 2A. Integrate the operation-chain boundary in Cascada

- Emit the compact compiler mutation access tree defined in [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree) and pass it once to ContextChain initialization. Collect all potentially executed receiver, property-container, and repair routes; truncate source-computed suffixes and merge static prefixes without evaluating application code. Use property maps with `{}` endpoints throughout, and distinguish omitted input from a root request. Keep poison-scope depth and actual-operation staticness separate. Emit special property names as own data keys. Cascada chooses literal versus constant allocation; the kernel preserves either input. Remove scope-path lists, property-target lists, endpoint flags, and compiler dependencies on private tree records in this cutover.
- Canonicalize routes from entered Chains against their originating root context before truncation and merging. Preserve computed-prefix provenance across rebasing; a relative static suffix cannot grant authority lost in its prefix. Include nested-entry and observation-only programs in compiler tests: the former contribute the correct root-relative routes, while the latter emit no mutation requests merely for method calls.
- Test generated trees for different `!` positions on the same receiver, property assignment/deletion, root cases, overlapping routes, conditional mutations, dynamic receiver versus native-suffix keys, and special property names. Reuse one compiled program with managed and external contexts at different first-boundary depths, including constant-tree reuse across renders. Verify generated setup has no application-expression evaluation or subtree scan, and retain compact shared prefixes in emitted code.
- Replace the hidden external sequencing mechanism with public context-path calls, property operations, and repair, then remove its compiler/runtime routing in that same Cascada cutover. Inventory its actual consumers first: `SequenceChain` also serves explicitly declared sequences, so do not delete unrelated sequence language features merely because they share an implementation. No sequence adapter or duplicate external scheduler remains.
- Adopt Phase 9F-A per-mutation managed rollback, owning-placement baseline retention, external subtree poison summaries, clear-before-call repair, and mixed-entry reservations. Keep compiler guard/recover sequence rollback separate from kernel mutation rollback. Preserve first-dynamic-segment source facts; compiler reference arguments and delayed control flow use enter without granting bang authority. Keep nonblocking assignment/deletion and recoverable failure from selected returned data, not an execution-wide Error history. Test compiled reference functions and conditional repair/replacement on a poisoned final target; ordinary entry must preserve its recovery state and run the callback without a compiler-only bypass.
- Emit entry at the source reference and let the runtime select its ordering anchor under Phase 9F-C. Establish entry before evaluating a slow condition; the condition and body run inside its callback. Supply source-static provenance without guessing host categories or calling a separate entry-target selector. Compare optimized entry lowering against unoptimized control flow, including false/no-op branches, missing/pending prefixes, intrinsic length, root deletion, source attribution, and repair. Supply nested mutation access paths and preserve fixed registered identities under native reset. Test the same compiled source with managed and external host shapes.
- Extend entry with mutation and observation path lists through the [batch entry protocol](enter.md#multiple-reference-arguments). These lists describe the callback's access requirements, independently of the context mutation access tree used for external registration. Capture each available anchor and its retained suffix at issuance, preserving original source provenance, and reserve static external coverage before managed gates can wait. Coordinate overlapping paths and shared pending prefixes before installing gates so one declared reference cannot queue behind another reference in the same entry. Derive references from shared selection/protection without duplicate mutating roots or writeback; start disjoint captures independently. Preserve per-reference readonly capability and captured managed values, including deferred fulfillment protection. Sharing scheduling state must not turn a readonly snapshot into a live mutable alias, and a read-only parent plus mutable child does not justify exclusive native access to the entire parent.
- Invoke the callback once the batch's references have passed their captured predecessor transitions and external effects. This readiness does not require resolving unused data values or retained path suffixes. Preserve each issued reference and its ordering position throughout selection; contained commands consume their own suffixes at their operation contexts and use the references supplied by the batch. For mutation `x.child` and observation `x.other`, both references participate in one entry before its slow condition runs, including when `x` is pending. Do not hoist the condition or all application reads before entry, or route a covered sibling read through an original Chain that would encounter the entry's own gate. An unrelated original Chain receives no implicit batch ownership. Do not nest sequential acquire-and-wait callbacks, delay ready reservations behind unrelated captures, or reserve guessed native candidates. Generated code never accesses private tree state. Phase 9F-C supplies the single-path capture/publication primitives only; Phase 7 owns list coordination, overlap handling, and its public API.

- Verify f(managedBranch, db) followed by db!.set(2) while managedBranch waits behind an earlier gate: f's eventual write must precede set(2). Test opposite argument orders across queued calls, equal and ancestor/descendant references, and a pending managed key whose prefix covers another argument. Include previous outside entries, pending external predecessors, nested issuing views, mixed readonly/mutable references and captured managed snapshots, selection failure, fatal resumption, and unrelated sibling progress. Assert no self/later dependencies, overlapping private publications, early release, or loss of Error effects; effect completion registration alone is not proof of reservation priority.
- Test an entry with mutation list `[x.child]` and observation list `[x.other]`, with its slow condition inside the callback and ready, synchronously delivered, and pending `x`. Reads through the supplied observation reference and writes through the mutation reference must complete without waiting on the entry's own protection. Repeat reads in loops and called Cascada functions, overlap with readonly ancestor references, and interleave later outside work. Include an unused reference with a never-settling Promise or invalid segment: unused data neither suppresses the callback nor creates poison. These are multi-path tests in this phase, not prerequisites for Phase 9F-C.

This phase changes Cascada's consumers of the public kernel API. Expression implementation, operator semantics, and compiler expression design belong to Cascada and are outside this project's deliverables. Do not implement or redesign them here.

Cascada retains graph and call results in Chains and uses lookupPathForExpression when selecting a value for expression evaluation. The kernel supplies only the documented extraction types and failure transport. Cascada can use the public Error factories and createPoisonedValue for its own synchronously completed failures; its pending failures use ordinary Promise rejection. Expression results entering Chain construction, import, assignment, or arguments use the existing supported input-consumption boundary and retain their causal Error.

Error queries remain successful inspection with a separate query-failure outcome. Diagnostic objects and Error collections remain ordinary data. Cascada owns how its expressions consume query results or explicitly propagate collected Errors; no expression evaluator, truthiness rule, arithmetic implementation, or compiler shortcut belongs in this package.

Final render/script output may be a graph. Complete public export, including nested availability and all required Errors, before delivery. A synchronous failure can use PoisonedValue; a pending render rejects its existing Promise directly with the ordinary Error. Preserve the final render fatal obligation through true settlement, without duplicating a delegated kernel result. Native callback adapters receive the ordinary Error.

Verify the integration using public operations: extraction types and ready/pending transport, call-result Chains, thenable paths after Phase 5, causal Error round trips through input consumption, and final export with complete nested Error membership. Compiler and expression implementation tests remain in Cascada.

### 3. Preserve local iterator finalization without fatal cancellation

Keep the ordinary finalization of a host iterator already owned by the exiting loop. This is an explicit narrow revision of the blanket no-host-work-after-fatal wording. Cascada's `for await` loops can call the iterator's `return()` implicitly when a pending `next()` completes and the loop observes fatal state; changing `break` to `return` does not suppress that native finalization. Distinguish this host protocol from internal `CommandIterator.abort`, which is removed with the scheduler's broadcast path.

- Use one operation-local iterator adapter/finalization path and at-most-once close ownership. Preserve ordinary iterator-protocol decisions about when `return` is required; do not manually close an iterator a second time after native `for await` already closes it. Wrap host acquisition, `next`, and live `return` actions through the shared integration boundary and validate their protocol results there. A live close failure is `IteratorFailed` at the owning loop's source. On otherwise successful break/return it becomes the loop's failure; when the loop already has a primary language failure, preserve that failure and own the secondary close outcome, matching throw-completion precedence in IteratorClose. Do not invent compound membership merely because finalization also failed. Fatal detection during either path always wins. An adapter may throw already-classified poison only to signal protocol abrupt completion; the loop's causal owner handles that expected escape before the fatal envelope, as specified in 9D-A.
- If fatal state is already committed when ordinary loop exit reaches close, allow only that exact owned iterator's `return` protocol to finalize. No new iteration, yielded-value admission, command dispatch, managed publication, or external mutation operation may start. A pending `next()` that never resumes does not trigger a sweep or forced close.
- Keep the execution-scoped external-action prohibition during that finalizer. Its deliberate post-fatal semantics differ from ordinary host-result processing: capture and own the close result/rejection without replacing, re-reporting, or waiting to deliver the authoritative fatal. Implement this one local boundary explicitly, not as an `allowAfterFatal` flag on ordinary graph/host operations. If the normal envelope cannot retain a close Promise before propagating the authoritative fatal, factor out its exact synchronous active-action bracketing for reuse by this adapter and expose that narrow primitive through the documented public API; keep the post-external-action fatal classifier on ordinary calls and verify that no other caller uses the finalization exception. The adapter marks only its execution and restores the Boolean in `finally`.
- Own every returned/derived close Promise at this finalization site. A close throw or rejection after fatal cannot create poison, select another fatal, or become an unhandled rejection. A never-settling close may leave internal finalization pending, while any pending public result has already been rejected through its independent outward action. Do not await cleanup before outward fatal delivery. A local runtime defect during live finalization remains fatal; the post-fatal best-effort handling is limited to secondary outcomes after the first fatal is authoritative.
- Update `AGENTS.md`, `error-handling.md`, `data-limitations.md`, and higher-runtime loop documentation to enumerate this exception. Kernel fatal observation still skips leases, owners, gates, phases, and graph work; no global list of finalizers, owner registry, listener, abort sweep, or cancellation mechanism is introduced.

### 4. Preserve diagnostics without kernel coupling

- Preserve Cascada's existing attribution path: compiler source entries identify the originating code, emitted calls and queued commands retain that entry, and the boundary that accepts a host result retains it through deferred rejection. Preserve the behavior of `PoisonError.wrap` that an existing poison keeps its original source. The compact source tables, command-owned operation contexts, and existing boundary continuations provide this behavior without a second Promise transport. Native Promise chaining by itself does not retain source attribution.
- Represent source as an immutable opaque handle backed by Cascada's compact context tables. Remove `renderState` from the context tuple and diagnostic stack frames, and remove `getRenderState`, `isFatalReported`, and `throwReportedFatal`; kernel graph code must not depend on the source shape or recover execution authority through it. Replace mutating context helpers such as `setContextLabel` and `mergeAddedContext` with builders that return a new immutable handle; copy retained route frames and added-context facts before making the complete handle immutable. Retain only source/diagnostic facts, with no render state, Execution, buffer, iterator, Chain, receiver, or closure pointing to operation work.
- Preserve async routes by capturing them where causal work is created, before deferred execution can lose its caller route. When a macro/include/extension or other existing diagnostic route adds frames, derive an immutable opaque source handle containing the static source and that immutable route, and pair it with the execution in the operation context. Pass it through the existing operation/continuation path; the eventual Error retains that handle. Propagated poison keeps its original handle. Replace `_diagnosticStack` and mutable render-owned route lookup only after every existing capture/forwarding site has a replacement. An adapter accepting an optional route is not itself a retention path. Use compact shared immutable frame tails or prepared context tables per route as appropriate; do not introduce an execution-wide diagnostic registry or reconstruct origin from a later consumer.
- Reuse handles for repeated work within the same prepared route. A deliberately distinct derived handle participates in the source component of Error equivalence, so failures on different diagnostic routes may remain distinct while repeated calls at one reused handle merge. Document and test that choice; do not promise both event-log multiplicity and static-handle reuse.
- Implement one hook-free formatter that projects immutable kernel Error facts and trusted source handles into the immutable non-thenable plain view consumed by `peekError`/`#`. Use safe stored messages, primitive source facts, recursively safe child views, and diagnostic-only cause summaries. Never put poison, a native Error, an exact arbitrary cause, or a protected identity in the view. Retain all semantic child/kind membership while bounding rendered text independently; display truncation must not silently truncate `.errors` or machine-readable kinds. A diagnostic Array or child must not become thenable through copied host properties.
- A language diagnostic view invokes no cause getter, `toString`, `then`, arbitrary Proxy reflection, or custom stack formatter. For a native Error recognized with `Error.isError`, a known own data-string message may be used through hook-free descriptor inspection; do not read accessor values or require a stack. For other causes use primitive-safe text or a fixed type summary without traversing the object. Source formatting reads only the runtime-created immutable diagnostic facts above. If richer host diagnostics need native cause stacks or application-specific inspection, keep that explicit host-side activity outside active language evaluation; it is not an extensible formatter hook used by `#`.
- Make formatter failure return a minimal successful immutable non-thenable view, never healthy `null`, poison, or a thrown diagnostic exception. Build the fallback solely from trusted stored kind/message/source facts, with a fixed fallback message where necessary and safe child views for compounds. Keep the fallback builder small and hook-free; it needs no Error factory, execution, or host callbacks. A failure formatting one child preserves the other children and that child's semantic kind through its fallback. Protective catches isolate presentation defects; they are not permission to invoke effectful host hooks during formatting.
- Implement the settled public split: kernel Errors expose only `name`, unformatted `message`, opaque `errorContext`, optional exact `cause`, poison `kind`, and compound-only `.errors`. Replace legacy `_errorContext`, expanded `context`, `fullMessage`, `totalErrorCount`, `kinds`, `getInfo`, and per-location fields with the separate immutable diagnostic view where Cascada still needs presentation. Do not decorate the frozen kernel Errors or leave accidental compatibility properties on them.
- Formatter failure never changes the semantic Error, its source, or execution state. Reporter failure preserves the already-committed fatal and cannot select/report a second candidate or change outward settlement. Safe language formatting and the captured host reporter have different responsibilities and do not share a configurable policy callback.

### 5. Reconcile public API and platform support

- Export the Error classes and recognition APIs directly. Treat deliberate direct construction, subclassing, prototype manipulation, and arbitrary caller-supplied kinds or sources as unsupported programming-API misuse; add no protection mechanism for them.
- Preserve and verify the existing Node `>=24` floor in both packages, including package metadata, CI, and documentation; this is already present, not a new version-floor migration. Require browser environments that provide native `Error.isError` and verify that support in the browser matrix. Use the native predicate directly without an approximate fallback. Older unsupported Node and browser environments remain outside the platform contract.
- Document normalized kernel results as T | PoisonError | Promise<T | PoisonError>, primitive expression results as ExpressionValue | PoisonedValue | Promise<ExpressionValue>, and getErrors results as null or a combined ordinary Error, with query-reflection failure returning its own Error instead of a completed collection. Expression and final native rejection reasons are ordinary Errors. Final script return accepts fully exported graphs as well as primitives and applies explicit failure conversion after export.
- Replace `markValuePromiseHandled` and any equivalent recursive scan with the explicit ownership split: the kernel owns its constructed and derived Promises until immediate consumption, delayed handled storage, or outward transfer; Cascada owns compiler-, loader-, iterator-, buffer-, and scheduler-created Promises plus any kernel result it does not return; the host caller owns a returned public Promise. Keep `markPromiseHandled` only where a known producer's semantic consumer attaches later, and apply it to the derived Promise as well as its source when needed. `observeDiscardedExpression` handles the exact discarded result at the compiler-emitted discard site. Never traverse unused host input or a discarded graph looking for Promises. Audit producers and transfers across both repositories, cover them with strict unhandled-rejection route tests, and remove broad safety-net scans.
- Remove all temporary adapters after the compiler, runtime, diagnostics, and public API use the final model.

### Verification

- Two simultaneous renders route fatal failures only to their own reporters and retain independent authoritative Errors.
- A throwing reporter cannot prevent outward fatal rejection, and a later candidate or nested reporter failure cannot replace the execution's first fatal or trigger another report. Test this through migrated Cascada render routes, not only kernel `Execution` unit tests.
- A fatal while any operation result is pending rejects it promptly, including behind a never-settling dependency. A result delivered first remains delivered while a later detached fatal is queryable and reported.
- A fatal in admission, validation, copying, Error collection, or publication that contributes to the final script export prevents successful render completion. A fatal in work that no longer contributes may occur after delivery and reaches the render's `onError` without revising that result. No render route treats a raw managed lookup, nested Promise container, or fire-and-register issuance outcome as completed script work when the omitted work is intended to contribute.
- Every ready operation result remains ready and incurs no outward wrapper, rejection registration, or microtask. A render whose outward results are all ready keeps an empty registration Set. Immediate non-blocking returns also remain direct. Error recognition precedes thenability, so ready poison is not accidentally assimilated merely to observe fatal state.
- Cascada starts no command, graph work, or new host effect after closure except the exact already-owned iterator finalization in section 3. It does not cancel or specially settle source Promises, gates, or phases, and ignores late operation work at common continuation checkpoints. An internal wait may remain pending without delaying any operation result.
- No fatal broadcast flag, iterator-abort sweep, bulk pending-command rejection, or shared fatal Promise remains. Actually pending operation results are the only registered outward fatal-delivery obligations, and repeated settled results leave the Set empty.
- Iterator tests cover normal exhaustion and required close on live break/return, close failure with and without an earlier language failure, and fatal observed after a pending `next` resumes. In the fatal case the body performs no further work and required local `return` runs at most once; its ready throw, rejection, never-settling result, and attempted kernel re-entry cannot delay/rewrite the authoritative outward fatal or produce unhandled rejection. A never-resumed `next` triggers no forced close. These tests distinguish native host iterator finalization from removed internal scheduler abort APIs.
- Standalone Function, environment method, extension/callback, iterator, and render-owned loader routes use the execution-scoped external-action guard and guarded continuation. An external action that catches its attempted same-execution kernel re-entry and returns success still yields that execution's first fatal; starting a distinct render execution is permitted. Compiler-controlled script calls and recursion remain internal and must not be wrapped as external actions. Cover ready, synchronous custom delivery, pending completion, and cross-execution entry. Standalone calls supply no raw context as `this`; declared context inputs are exported snapshots, and exact external receivers require ordinary path authority. Runtime-created failure payloads and successful results obey the 9D-A/9D-0 boundary contracts.
- Ready and pending poison have identical kind, source, graph effect, and public behavior across compiler-generated control flow, callbacks, calls, import, export, and mutation.
- Through compiled calls and final script export, repeat the kernel complete-collection and publication-failure scenarios: an unreadable property between required failures, a later rejecting sibling, Array sorting/flattening, and an independent operation-result Error alongside receiver publication failure. Verify complete semantic membership, originating script source plus exact native causes, no native invocation with failed prepared inputs, and no early script-result settlement. Keep atomic import, failed-query, structural-payload, and iterator-finalization precedence as specified; do not replace those contracts with universal collection.
- Port the source-location assertions in Cascada's `tests/poison/runtime-promise.js` and the origin-preservation cases in `tests/poison/unit.js` before removing `RuntimePromise` and `valueWithOrigin`; adapt assertions to the final Error surface without weakening their source expectations. Verify ready throws, delayed host rejection, Promise-backed property access, deferred sequential commands, and a failing call inside a macro whose result is consumed elsewhere. Assert original path and exact line/column, not merely nonempty diagnostics. Add a successful producer followed by a separately failing consumer and distinct nested operations on one line. Reusing one raw native Error at two different source handles must retain both attributed leaves in collection; repeated propagation of one poison must still merge. Error order remains unspecified.
- Native Promises and Cascada's retained sync-first thenables use the same ordinary continuation helper. Ready custom outcomes add no microtask, repeated subscriptions preserve FIFO order across settlement, synchronous callback failures unwind through the fatal path, and the normalized returned result is the sole readiness test. Only returned pending chains enter wait/protection machinery; no resolved-value marker, callback/backwrite readiness flag, or kernel thenability cache exists, and `IteratorWaitToken` never crosses the integration boundary.
- Compatibility tests cover the former `PoisonedValue` thrown-poison conversion explicitly: the replacement lets a synchronous callback throw escape unchanged, while pending callback failure rejects its returned chain. Rejection observation accepts custom receivers and creates no observer for synchronous completion; independent results never extend completed path selection or receiver publication.
- A failing trusted live cleanup callback is never suppressed by migrated legacy `finally` handling; ready throws and deferred failures retain the callback's fatal-on-escape contract.
- Ready and pending `#` inspection returns the same non-thenable diagnostic-view shape, healthy inspection returns `null`, child selection never rethrows poison through assimilation, and query failure remains poison. Frozen Error wrappers receive no `didIterate` or other control-state writes.
- Hostile cause getters, coercion methods, `then`, and stack-formatting hooks record zero invocations during `#`, including hooks that would attempt re-entry. A deliberately induced formatter defect produces the minimal successful view with preserved kind/source and safe compound children; it never changes Error state or returns healthy `null`. Primitive reasons, native Errors with accessor diagnostic fields, and opaque hostile causes have safe summaries. Mutating an original source-builder input after publication cannot change stored Error attribution or a previously returned view.
- No legacy Error wrapper, Promise subclass, separate fatal Boolean/latch, report state, transport kind, attribution property, or compatibility path remains.
- Compact contexts and captured diagnostic routes survive deferred work, nested calls, copies, and later Error propagation without consumer reattribution. Derived handles retain no render/buffer/execution authority. Complete child/kind membership survives bounded compound text display. Exact compliant causes remain available for explicit host diagnostics; language inspection does not trigger arbitrary cause-stack formatting.
- Every compiler-emitted kernel call carries an operation context from the current render's table. Repeated execution of one exact static source reuses its immutable carrier; distinct source handles remain distinct; no diagnostic handle retains or recovers `RenderState` or execution authority.
- Cascada imports only the documented root API. Kernel operation calls own their pending results; helpers and scheduler commands do not create extra registrations. A render with additional required work owns its final result exactly once, while aliases delegate it unchanged.
- Focused Error, result-return, and Promise-ownership audits and route tests cover both repositories. The actual-export classifier fails on unclassified package exports, while no custom source analyzer or semantic manifest is introduced. Discarded expressions and every stored or fire-and-forget higher-runtime Promise have one exact owner without recursive Promise scanning.
- The complete Node and browser test matrix passes under the documented support policy.

Update Cascada runtime and compiler documentation, kernel integration documentation, public API and type documentation, Error examples, and the supported-platform matrix.
