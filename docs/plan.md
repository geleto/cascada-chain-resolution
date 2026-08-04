# Plan

## Runtime Work

1. **Implemented: subtree counters replace the CLEAN flag.** `src/refcounts.js` owns exact `promiseCount`/`errorCount` totals for ref-indexed branches. Ref-indexing is lazy and per branch; never-checked data pays zero counter bookkeeping. Writes, deletes, and live Promise-property resolution use atomic property transitions, while indexed COW copies reconstruct counters from their own placements.

    Implemented rules:

    - Ref-indexed regions are downward-closed: ref-indexing walks whole subtrees, and writes into ref-indexed parents ref-index the entering value before commit.
    - The ref-indexed gate is evaluated at commit time, never captured at registration time.
    - `parents === undefined` means not ref-indexed; an empty `Map` means ref-indexed root / no ref-indexed parents.
    - CLEAN is only derived: clean means `promiseCount === 0 && errorCount === 0`.
    - Ownership/COW stays mark-based; counters answer "what is pending/broken below me", and the SHARED mark answers "who else can see me".
    - Error values count as language errors inside ref-indexed branches.
    - Non-extensible nodes follow the same counter rules as extensible nodes. Errors and writable Promise properties inside them are valid, and metadata uses the WeakMap fallback.
    - Counter metadata, promise mirrors, read-entry counts, and the SHARED mark share the single `META` record; `src/meta.js` owns generic metadata and `src/promise-mirrors.js` owns mirror lifecycle.
    - `hasError` and `getErrors` activate ref-indexing at their public operation boundaries. Export uses raw traversal without counters.

2. **Implemented: single META record and accessors.** `src/meta.js` owns the one logical metadata record. Storage is selected by `STORE_META_IN_WEAKMAP`, derived from `CASCADA_META_STORAGE`: inline non-enumerable Symbol property by default, or WeakMap when set to `weakmap`. Shared marks, read-entry counts, promise mirrors, and subtree counters all use that record, and `shallowCopy` never copies it as language data. The default test command runs the complete suite once in each mode.

    ```js
    function createMeta() {
        return {
            // shared: added when ownership first becomes shared.
            // mirrors: added when the first promise mirror is installed.
            // readEnterCount: added while read-only entries are active.
            // cycleCuts: added when the first plain-property cut is published.
            // promiseCount, errorCount, cycleCutCount, parents: added by ref-indexing.
            // importBoundary: added at a direct import boundary.
        }
    }
    ```

    Implemented rules:

    - `metaOf(value)` returns only the node's own metadata. Inline mode uses an own Symbol on extensible nodes and the same WeakMap fallback as WeakMap mode for non-extensible nodes.
    - `requiresCopyOnWrite(value)` combines an explicit shared mark, implicit sharing from non-extensibility, and any active read-only entry.
    - Promise mirrors live in `meta.mirrors`; `src/promise-mirrors.js` creates the map lazily as `Object.create(null)` and owns mirror lifecycle.
    - Counter fields live directly on META. `parents === undefined` remains the ref-indexing gate; record existence alone does not mean counters are live.
    - COW copies receive no copied META object. If counters are live, `indexValueIfSourceIndexed` creates fresh metadata and reconstructs counts from the copy's logical placements.

3. **Superseded by items 11–12: eager import screening.** Imported cycle preparation is eager and lives in `src/import.js`; subtree counters and DAG edge multiplicity remain lazy.

4. **Superseded by items 11–12: recursive import marking.** Imported cycles and nested Promises are discovered eagerly without marking every descendant as a direct boundary; non-extensible metadata uses the common WeakMap fallback in both storage modes. Full design: `docs/import-preparation.md`.

5. **Superseded by item 12: separate write bookkeeping helpers.** Property replacement uses `preparePropertyTransition` before commit, while assignment, deletion, mark publication, and mirror drain all share one atomic live-edge bookkeeping primitive. Full design: `docs/counters-implementation.md`.

6. **Superseded by item 18: counter-settled export.** Export no longer
    ref-indexes or pins its reached branch. The current immediate raw
    copy-or-collect design is specified by item 18 and
    `docs/export-error-set.md`.

7. **Implemented: `hasError`.** `hasError` uses subtree counters, Promise
    mirrors, the non-marking context-threading `walkObservationPath`, and the
    ref-indexing walk. It builds the generic ref index only for the value reached
    at the path, answers settled branches directly from `errorCount` and
    `promiseCount`, and allocates the final boolean race only for a pending
    branch. It is a pure query with no ownership mark and returns a bare boolean
    whenever the answer is decided before suspension.

    Empty path probes the root itself; non-empty paths use `walkObservationPath(chain, path, onResolved)`. A missing final target reaches the callback as `undefined` and is false. Missing/null/undefined or primitive intermediates become a language Error inside the resolver and are true; an existing Error is propagated. All property reads, promise handling, and import-context threading therefore remain inside `walkObservationPath`. No extraction marking occurs: only a boolean escapes (issue 4's lookupPath would mark; hasError must not, and unlike export it never marks the reached branch either). `__proto__` and own non-enumerable segments follow lookup semantics — missing as a target, Error when another segment tries to dereference them.

    Deliberately no pin: marks are irreversible, so pinning for a boolean would permanently convert every queried branch to COW-on-write — a query must not change the program's write behavior. And the wait tree makes a pin unnecessary for exactness: the wait set is captured at issue time and extended only through resolved values read at hasError's own FIFO slots, so the answer reflects the issue-time branch plus its recursive exposures. Later-issued installs are simply invisible (the "original indexed frontier" test pins this); later-issued overwrite/delete can detach a watched promise's resolved value from the live tree, but the captured mirror still answers for the issue-time branch. This is the query contract. At the reached branch:

    - `hasErrorAtPathValue` calls generic `buildRefIndex` at the path-value boundary only. The branch is fully indexed, preserving the invariant that a ref-indexed parent never has a tracked child without counters.
    - On the indexed branch, `errorCount > 0` -> true immediately (a counted error sits under settled positions; no earlier-issued remainder can remove it). `promiseCount === 0` -> false immediately (every earlier remainder rode a counted promise). Both are bare booleans.
    - Pending handling starts in `collectErrorSearchWaits`: after `buildRefIndex` succeeds and only when `promiseCount > 0`, it descends the ref-indexed branch through nodes whose counters still contain promise/mirror work and pushes one wait per pending key through the required existing mirror: `mirror.onResolve(() => probeResolvedPromiseForErrors(mirror.currentValue, resolveError))`. Registering waits after `buildRefIndex` is load-bearing: preparation minted and registered mirror writeback first, so hasError consumes the value after every earlier FIFO advance. Behind a promise barrier, `probeIndexedBranchForErrors` checks the prepared branch's counters and returns any nested readiness tree. The shared collector builds each `Promise.all(waitPromises)`, and hasError races the error signal against the clean readiness result through `resolveOperationResultOrFatal`.
    - Promise-mirror preparation guarantees that, before each later FIFO consumer runs, `currentValue` is an untracked value/Error or a ref-indexed tracked branch, with any cycle Error held in the mirror's placement metadata. Issue 12 keeps this preparation private while consumers drain: a live mirror attaches only its final state, while a revoked mirror never touches the former parent property or counts. Each hasError settlement continuation checks the prepared placement counts, handles clean scalar cases directly, and probes an indexed tracked `currentValue`; it never re-enters `hasErrorAtPathValue`. If it sees more issue-time promises, it returns that nested `Promise.all`. When the whole promise tree drains, the clean side resolves false.
    - One call-local `visited` WeakSet is shared through the complete promise tree. Every traversed node is checked and added, so an imported identity repeated across synchronous or promised paths is visited once without permanently marking unique descendants. It does not retain settled branches while another captured promise remains pending. A trusted identity cannot recur inside one branch under the compiler's single-owner/COW contract.
    - Accepted corner: a later-issued overwrite/delete of a pending key decrements live counts synchronously but wakes nothing until the revoked promise settles — the answer is delayed, not wrong (that promise was in the wait-set as of hasError's issue position, exactly what sequential execution waits for); a never-settling revoked promise leaves hasError pending.

    A reached non-extensible branch uses ordinary counters; contained Promises are awaited and contained Errors return `true`.

8. **Implemented: fatal error reporting.** Internal/runtime failures go through the global fatal boundary: `reportFatalError(error)` reports and throws. Fatals are never language Error values and must never be confused with rejected data promises, which `resolveInitialValueOrPoison` converts into Poisons at promise-settlement boundaries.

    Required shape:

    - `src/error.js` exports `reportFatalError(error)` and `setFatalErrorReporter(reporter)`; the sandbox reporter is a no-op, and `reportFatalError` always throws the original error after reporting.
    - An object-like fatal value is reported once per identity even when it unwinds through nested wrapper layers; every `reportFatalError` call still throws the original value.
    - Internal invariant failures, compiler-contract violations, continuation throws, and late failures in hasError/export wait branches call `reportFatalError`.
    - `resolveInitialValueOrPoison` has exactly one data-facing catch: promise rejection becomes a Poison before the continuation runs. Exceptions thrown by the continuation and failures while converting a rejection reason are Fatal and routed through `reportFatalError`.
    - Issue 12 collapses `resolveInitialValueOrPoison` to one reaction on the source promise: the fulfilled branch calls `runFatal(fn, value)`, while the rejected branch performs `toPoison` and invokes `fn` inside the same `runFatal` call so conversion failures remain Fatal. Do not resolve an intermediate proxy and invoke `fn` in a second reaction. One-stage data and internal consumers then preserve their registration order when mixed on the same promise; mirror-specific draining supplies the additional guard needed by synchronous settled reads.
    - Runtime aggregate promises such as hasError's clean wait tree use `resolveOperationResultOrFatal`: source rejection is Fatal, not converted to a Poison. Races that may answer before all internal waits finish attach this Fatal handler to the losing waits, so a later kernel bug is reported even after the public operation result has already settled.
    - Item 19 adds `onLaterPromiseReady` for later resolvers of an already seeded Promise property version. Both fulfillment and rejection mean only that the initial resolver can now be observed, so the raw result is ignored and the callback runs through `runFatal`. The helper returns its derived Promise so export and Error-query readiness trees can compose it through `Promise.all`.
    - A fatal in a discarded internal mutator continuation is reported and leaves its derived promise rejected. Mutators deliberately return nothing, so that rejection reaches the host as unhandled; this is the fatal contract, not a language Error conversion.
    - `runFatal` catches only synchronous throws. Every public operation uses it for its synchronous prefix, while `resolveInitialValueOrPoison` and `resolveOperationResultOrFatal` own the data and internal asynchronous rejection policies without adding another reaction.

9. **Implemented: Chain root state location.** Cascada roots are mutable locations, not bare values. A Chain whose `_state.value` holds a Promise therefore still needs that stable parent/key for its normal promise mirror. The sandbox now exports `Chain`; public operators receive a `Chain`, immediately operate on the private `chain._state.value` holder slot, and never walk or ref-index the `Chain` object itself.

    Implemented shape:

    - Public operators receive the `Chain` and operate on `chain._state.value` as the root value.
    - Mutating operators return nothing. They synchronously replace `chain._state.value` when the root is available; when it is a pending promise, the ordinary promise mirror for `_state.value` serializes root-level operations and commits its final drained value only while that mirror remains live. Values are observed only through lookupPath, export, hasError, or getErrors; the Chain slot remains the authoritative root location.
    - Bookkeeping functions (`buildRefIndex`, `markShared`, `markImported`, promise mirrors, COW, export/hasError branch probes) receive only values below `_state.value`, never `chain`; the private `_state` holder can carry normal META, but it is host state, not language data.
    - Other `Chain` fields such as command arrays, caches, schedulers, and bookkeeping are outside the language object graph. They are not counted, copied, marked, mirrored, or validated by this kernel.

    This keeps the root promise ordering problem solved without turning host runtime objects into Cascada data. A call shaped like `assignPath(chain._state.value, path, value)` is invalid for mutable roots because it cannot update the root location; the valid call shape is `assignPath(chain, path, value)`.

10. **Implemented: `getErrors` collects all errors in a branch.** `getErrors(chain, path)` returns the distinct Error values reachable in the issue-time branch at `path`. It resolves the full path through observational `walkObservationPath`: an existing Error encountered along the path is propagated, while a missing/null/undefined or primitive intermediate becomes a new path-access Error. An Error-blocked or broken path therefore returns that Error. Any successfully reached terminal with no reachable Errors returns `[]`, including missing, null/undefined, primitive, and clean tracked terminals regardless of extensibility. No path or position metadata is returned.

    The only operation-level `buildRefIndex` call is at the reached path-value boundary, with the inherited import boundary. That build indexes every raw-reachable tracked value as cut-separated components. The operation is a pure query: no shared mark and no settlement pin. Its promise frontier is captured at its program position and extended only through values observed in getErrors' FIFO slots, so later-issued installs are invisible and a later overwrite/delete does not discard a promise already captured by the query.

    Promise-mirror preparation preserves the indexing invariant for both live and revoked mirrors. Before a later FIFO consumer sees `mirror.currentValue`, it is an untracked value/Error or a ref-indexed tracked branch. A live mirror attaches only the final drained state; a revoked mirror performs the same private preparation/ref-indexing without writing the holder or attaching the private branch to it. This responsibility stays at the promise-mirror/refcount boundary rather than making each observer call `buildRefIndex`.

    `hasError` and `getErrors` call `buildRefIndex` only for the value delivered by `walkObservationPath`. Resolved Promise branches are already indexed by mirror processing. Both operations then use one counter-fenced traversal: a subtree is skipped only when its Promise, Error, and cycle-cut counts are all zero. A positive cut count guides the traversal to actual cut placements, and each independently indexed target resumes the same fenced traversal. Captured private and terminal targets satisfy the same counter invariant before the query inspects them.

    Each projected Promise key registers one `PromiseMirror.onResolve` continuation and contributes its recursive readiness. `Promise.all` therefore represents the complete captured Promise tree. `hasError` races that completion against its first-Error signal; `getErrors` waits for completion before returning its complete Error identity set.

    Accumulate Errors in one call-local `Set`. One operation-local `visited` WeakSet spans every fenced component plus every recursive Promise slot. Weak visitation does not retain settled branches while another captured promise remains pending. Error identity is the result deduplication rule: the same Error reachable at multiple keys appears once, while distinct Error instances remain distinct. Result order and structural position are not semantic; tests compare membership rather than settlement-dependent insertion order. At the same program position and exact path, `hasError(chain, path) === (getErrors(chain, path).length > 0)`, including missing and primitive paths.

    The two operation shells remain separate in `src/observations.js`: they share `walkObservationPath`, counters, mirror access, fatal indexed-branch assertions, and the fenced Error-search traversal, without parameterizing hasError's first-error race or getErrors' exhaustive result policy. Export alone uses `src/raw-walk.js`. Coverage includes synchronous nested errors; errors behind multiple promise barriers and cycle cuts; rejection conversion; same Error at multiple keys and through a DAG; missing, primitive, Error-blocked, frozen, and cyclic paths; a known Error plus an unresolved promise remaining pending; later-issued installs remaining invisible; overwritten/deleted captured mirrors still contributing their private results; concurrent queries with independent issue-time frontiers; coexistence with an independent export; no shared mark under either metadata storage mode; and `hasError(chain, path) === (getErrors(chain, path).length > 0)` at the same logical program position, synchronously and behind Promise barriers, including broken required prefixes.

11. **Implemented with item 12: eager imported-subtree cycle preparation.** Import marks its boundary root, stores `{ root, errorContext }`, and immediately walks the detached external graph to discover cycle-closing properties and nested Promises. Subtree counters remain lazy. Trusted language data follows the compiler's single-owner/COW contract and uses the ordinary tree-shaped ref-index walk without identity or cycle bookkeeping.

    **Implementation sequencing.** Items 11 and 12 landed as two internally atomic parts of one design. The mirror-drain foundation includes one-stage `resolveInitialValueOrPoison`, `PromiseMirror.onResolve` with `pendingConsumerCount`, zero-count settlement and single-commit semantics, `readLanguageProperty`, placement-sensitive counts, and migration of every mirror consumer. `verifyRefCounts` recounts a draining live mirror as `[1,0]` and reports a parents-graph cycle fatally. The imported-projection part adds `src/import.js`, eager rooted preparation, deterministic cycle Errors, and cycle-aware export.

    **Import boundary.** `import(value, errorContext)` rejects every falsy context. An object root receives the import/shared mark and is prepared synchronously before import returns. A promise root uses one `resolveInitialValueOrPoison` wrapper that performs the same preparation before language consumers observe its resolved value. Preparation owns the imported-only identity/path state and nested Promise registrations, but allocates no counters.

    **Before ref-indexing.** The imported root's shared mark protects its complete subtree through inherited COW state. A mutation copies from that root before entering descendants; `shallowCopy` gives every retained tracked source child direct provenance, while omitting META keeps every new path copy owned. A Promise property's mirror carries its effective provenance until the property becomes a plain tracked child or its active path consumer produces an owned copy. Retained forks sample that provenance at the same FIFO position as `currentValue`; a drained mirror transfers it before COW drops the mirror. `lookupPath` gives an extracted imported value a new boundary rooted at that independently used value. Aliases and cycle cuts are already known even when no counter operation is ever issued.

    **Imported preparation and ref-index commit.** `prepareImportedData` starts the root walk once when a direct boundary is created. Each synchronous segment has a current path and weak visited set. A current-path repeat receives a cycle Error; another same-segment repeat is marked shared and skipped. Every first-prepared tracked identity receives META. A non-root META hit therefore identifies an already prepared/runtime-owned identity globally: it is marked shared and checked only against the copied current ancestry by the private fixed-path scanner instead of receiving full preparation again. A synchronous match propagates to the property or mirror that entered this prepared island; it is never stored on an inner shared node where revocation could leave it as a phantom. The freshly marked boundary root is the explicit exception. Pending properties receive mirrors plus preparation consumers. `buildRefIndex` later indexes only the reached branch, expanding through each cycle-cut target as a separate component.

    **Imported attachment.** Assignment within an imported path is a separate operation. After any COW, the mutation walk passes the actual destination ancestry to `attachImportedDataToImportedData`. The attachment entry delegates recursive work to the same fixed-path scanner used for cross-segment prepared duplicates. Any synchronous route into the fixed path receives one cycle Error at the attachment's incoming placement, even when the matching reference is deeper in a prepared island. Retaining that path across a Promise marks its root shared, so later language mutations COW and the continuation classifies the preserved issue-time world.

    Ordinary ref-index construction walks the reached branch and builds counters and parent edges, treating pending mirrors as `[1,0]`. Imported Promise writeback first records private raw state without indexing it. The following full-preparation consumer resumes with the inherited boundary, copied current path, and a fresh segment set, then prepares the child index before later FIFO consumers run. If it reaches a META-bearing identity, the original full-preparation consumer for each nested Promise precedes the later fixed-path consumer by FIFO. Fresh data cuts actual DFS back-edges; a fixed-path scan cuts the placement that entered a prepared island. Together they leave a finite projected graph without a second imported graph representation. Extraction and retained COW children create a new direct boundary when a value becomes independently usable; nested Promise settlement remains inside the existing boundary.

    **Imported DAG aliases.** Every repeated imported identity is marked shared, and META makes that detection persistent across Promise segments and import calls. Same-segment repeats are then skipped. A later segment or import that reaches a META-bearing identity uses a fixed-path scan to find references into its copied ancestry without repeating full preparation. Ordinary ref-indexing still visits each projected structural placement, so aliases retain exact parent-edge multiplicity. Trusted data has no equivalent identity walk.

    **Promise settlement.** Eager preparation registers one full-preparation continuation at every newly reached pending imported placement without awaiting sibling work. Cross-segment duplicates, assigned attachment, and retained imported Promise forks register fixed-path continuations. `mirror.importPreparationRegistered` tells the mandatory consumer to retain only `mirror.currentValue`; the following import continuation classifies and prepares it before later FIFO consumers run. Each continuation resumes only its registering work: full preparation uses copied growing ancestry, while a fixed-path scan retains one immutable comparison path. A synchronous fixed-path match propagates to the entering mirror, so full-preparation and attachment scans of the same resolved value converge idempotently instead of publishing cuts on both the mirror and an inner shared property. A nested Promise reached by the scan owns any cut from its later settlement. Assigned attachment additionally pins its destination root; a retained fork scans the ancestry captured at fork creation without pinning the owner. Every completed walk builds a child index only if its owner is already indexed; a later walk may still atomically publish additional path-dependent cuts before its own successor. Settlement creates no nested direct boundary; root promises retain the public import wrapper because no object root exists to carry a boundary before they settle.

    **Attribution and non-extensible data.** Imported provenance remains inherited from the relevant boundary root until extraction marks its result or COW retains a tracked source child. A path child's next shallow copy omits that metadata and becomes owned again. A Promise mirror carries property-level provenance, including after drain; forks sample it in FIFO order, retained properties preserve it, and an active mutation path consumes it. Nested Promise results otherwise inherit provenance without receiving direct boundaries. Preparation gives every tracked identity META but adds the shared mark only to repeated identities; descendants do not otherwise receive direct boundaries. Non-extensible values are implicitly shared, store metadata in the WeakMap fallback, and otherwise follow ordinary indexing rules.

    Error queries keep one operation-local `visited` WeakSet across their cut-separated fenced traversal and captured promise tree. Other deduplication remains local to its semantics: imported preparation uses durable META plus one per-segment weak set, each fixed-path cycle scan owns its own visited set, export preserves output graph identity with an old-to-new map, and verification uses its own synchronous seen set. Do not introduce one generic deduplication abstraction across these different policies.

    Coverage includes: rejection of empty and other falsy attribution contexts; eager nested Promise registration without eager counters; one wrapper for an imported promise root; mutation and extraction before ref-indexing; synchronous and cross-import DAG aliases receiving shared marks; an identity present synchronously and exposed again by a later promise; recursively exposed promise branches; an error query registered between two import-preparation consumers; independent full-preparation and fixed-path Promise registrations; attachment-path pinning across later direct, ancestor, and promised-ancestor COW; rooted cycle detection and exact multiplicity; non-extensible branches; and both metadata storage modes.

12. **Superseded by item 17: imported cycle Errors.** This item records the
    attributed-Error cut model that item 17 replaced with boolean cycle cuts.

    **Imported-cycle boundaries.** The public `import(value, errorContext)` operation, eager imported-data preparation, imported attachment, and cycle-Error handling live in `src/import.js`; all recursive cycle walks are private. Import validates the truthy context, stores `{ root, errorContext }` on the boundary root (or wraps a root promise), ensures META on newly encountered host objects, and immediately runs `prepareImportedData` on the detached graph. A pre-existing META island remains runtime-owned. The walk publishes mirrors, actual back-edge cuts in fresh data, and entering-placement cuts for fixed-path matches in prepared data. At a Promise it copies the current path, then resumes full preparation with the inherited boundary and a fresh segment set. META-bearing repeats, assigned attachment, and retained Promise forks use the same private fixed-path scanner; assigned attachment additionally retains and pins its post-COW destination path. No generic prospective property scan exists and no other subsystem detects or creates cycle Errors. `src/property-transitions.js` coordinates physical property state, while `src/refcounts.js` owns generic index construction and atomic count transactions over the prepared projection. Generic metadata storage remains in `src/meta.js`.

    Native code receives tracked Cascada data only through metadata-free
    export output. Preparation creates META on every first-reached
    tracked identity, so a later META hit means the value was already prepared
    or runtime-owned. The new preparation marks that repeated identity shared
    and scans its prepared graph only against the new ancestry. Raw kernel calls
    that expose metadata-bearing runtime values to mutable host code remain
    outside the integration contract.

    Preparing a fresh metadata-free import is O(n), while each META-bearing repeat adds one fixed-path scan of its prepared reachable graph for the new ancestry; ref-index construction remains lazy. Both preparation and indexing are recursive and therefore bounded by the JavaScript call stack on very deep data. Each full-preparation Promise continuation resumes one synchronous segment with its copied ancestry and a fresh segment set. A fixed-path continuation retains its scanner-local visited set instead. No nested boundary, imported-node graph, or repeated full preparation is retained.

    **Observable edge model.** Imported host data remains physically unchanged. A cyclic property keeps its raw value and receives a cached Error in `meta.cycleErrors[key]` or `mirror.cycleError`. Refcounting does not descend through that raw edge or install a reverse parent edge; the cycle Error contributes `[0,1]`, making the counter graph finite without changing the value graph. Lookup, mutation, and cycle-aware export continue through the raw logical value. `hasError` and `getErrors` expose the cached Error. The owner/key placement is the identity: aliases reaching the same property reuse one stable cached Error, while distinct cyclic properties receive distinct Errors.

    Every cached cycle Error message names its property key and carries the applicable import attribution, for example `Cyclic property "back" (imported at: ...)`. A full path is deliberately not stored because a shared property can have several paths. The first committed attribution for one owner/key wins, matching the existing first-import rule. Imported data is treated as externally immutable after crossing the boundary, so the cycle result may be cached; arbitrary later host writes are out of scope, while runtime promise settlement and language COW are managed transitions that must update it.

    **Deterministic imported-cycle Errors.** `prepareImportedData` begins one depth-first walk from the stored import root with an empty current path. A repeat within the same synchronous segment is skipped. If a property points into the current path, that exact property receives its own stable attributed cycle Error and is not followed. A Promise preparation continuation copies the imported current path at registration. At settlement it processes new identities with a fresh segment set; identities prepared by an earlier segment are scanned only for references into that copied path. Existing cycle Errors are cuts during later walks and are not traversed again.

    `Object.keys` order, the stored boundary root, copied Promise paths, and FIFO registration define these cuts regardless of which nested path triggered preparation. Each synchronous segment is an ordinary DFS and each Promise continuation retains the ancestry needed to detect its closing back-edge. Cutting those placements makes the projected graph acyclic without a second graph-analysis pass. Extraction establishes a stored root for its result, while COW establishes one on each tracked source child and drops it again from the metadata-free path copy; nested Promise settlement retains the inherited root.

    Valid language assignment cannot create a new alias or cycle because an escaping value is shared and mutation COWs before placement. Imported Promise settlement can expose host aliases and cycles. Its mandatory writeback stores the resolved value privately and defers imported indexing; the following full-preparation consumer resumes from its captured ancestry before preparing the index. A reference from a prepared resolved island into that ancestry marks the Promise placement regardless of depth, because the cycle depends on the placement. A cycle wholly internal to fresh resolved data marks its actual DFS back-edge. The final drain publishes only that classified state.

    **Preparation state.** Preparation publishes facts during its DFS segments. Every first-prepared tracked identity receives the ordinary META record, whose presence doubles as the durable prepared-identity signal; no imported-node graph or dedicated completion field is retained. `markImported` reports whether it created the direct boundary, so only that creation starts preparation. Pending full-preparation continuations retain a copied ancestry and fresh segment set in Promise reactions; fixed-path scans retain only their immutable path and local visited set. Existing cycle Errors and settled mirror values are part of the imported logical graph, not their stale physical properties. Fatal failure ends runtime execution, so preparation does not carry rollback scaffolding for metadata already published before that failure.

    One edge-transition core owns ordinary replacement, deletion, cycle-Error publication, mirror writeback, and walk advances. `preparePropertyTransition(owner, propertyMirror, newValue)` prepares imported/shared state and the child index without changing the live placement; the import DFS publishes a cycle Error separately at the exact edge it discovers. Every live commit snapshots the old contribution, performs the already-validated placement update, reads the new contribution through the same cycle-aware accessors, swaps the reverse edge, and propagates exactly one delta. A null property mirror is an ordinary value transition. Assigning or copying a fresh Promise immediately commits its new mirror placement as `[1,0]`; the mirror's successful drain later uses the same primitive for `[1,0] -> final state`. A revoked mirror retains only its private `currentValue` and never commits against its former parent.

    **Promise consumer ordering.** Collapse generic `resolveInitialValueOrPoison` to the one-reaction form defined by issue 8, then route every callback that consumes a promise through a mirror — writeback, mutation/observation walks, forks, and error-query waits — through `mirror.onResolve(fn)`. Share one private reaction runner so value conversion and Fatal handling are not duplicated. The method increments `mirror.pendingConsumerCount` synchronously, registers directly on `mirror.promise` at that program position, and invokes `fn` with the same fulfilled-or-Poison value as `resolveInitialValueOrPoison`. After `fn` succeeds, a non-final consumer decrements directly; the final decrement occurs inside the drain's placement update. A synchronous Fatal therefore leaves that consumer's count outstanding and prevents publication without a separate failure flag. A failure while converting the source rejection is Fatal before the mirror callback and likewise leaves the registered count outstanding. Runtime functions are not async: any deeper wait is registered before `fn` returns, owns its own mirror ordering and rejection policy, and does not delay this consumer. Generic promise uses that have no mirror continue to call `resolveInitialValueOrPoison` directly.

    Registering a mirror's mandatory writeback creates its first counted consumer before the mirror is observable. Source resolution lets each successful consumer prepare and store the next `mirror.currentValue`/Error state before the following FIFO consumer runs, but the live edge remains operationally pending while any registered consumer remains. When a successful consumer is the sole outstanding consumer, it refreshes the final preparation if the owner became ref-indexed, commits that state to the live placement if the mirror is still live (or leaves it private if revoked), and decrements to zero. Zero is the settled state. This commit-time gate preserves downward closure, while registered import continuations classify imported cycles before that final drain. A synchronous fatal completion, including a falsy thrown value, never decrements; later queued consumers may finish their private work, but the retained count prevents publication permanently. A consumer registered during the source-settlement-to-writeback gap therefore keeps the mirror pending until its advance has run. No program continuation, whether tied to the same promise or an unrelated one, can use the synchronous fast path before every earlier registered mirror consumer has applied its synchronous advance.

    **Logical reads and edge counts.** `pendingConsumerCount === 0` means the source resolved, all registered mirror consumers drained, and the final commit succeeded. It also distinguishes a legitimate settled `undefined` from an uninitialized current value. Use two deliberately different operations:

    - `readLanguageProperty(parent, key)` checks the live mirror first. A drained mirror returns `currentValue` synchronously; a pending mirror returns its original Promise regardless of the physical slot, forcing the caller through `mirror.onResolve(...)` behind every earlier registration. With no mirror, it returns the own enumerable physical property. It ignores cycle metadata and is used by lookup, mutation, COW, promise forks, and the raw logical walker; the own-enumerable physical read is its internal fallback rather than a second public operation.
    - `getPropertyRefState(parent, key)` returns both the placement's count contribution and its reverse-edge child. A draining mirror contributes `[1,0,0]`; a published cut contributes `[0,0,1]`; and an ordinary value contributes its normal counts. Live-edge commits inspect this state before and after the property update. Keeping the draining edge pending is load-bearing for indexed Error queries and exact parent totals.

    The parent contribution does not bounce through intermediate resolved values while consumers drain. It remains pending, each consumer privately prepares the current value needed by the next consumer, and the zero-consumer commit performs one transition to final counts. This prevents indexed observers from seeing a transient clean state before an earlier-issued advance. If the mirror is overwritten or deleted first, removal detaches that one pending contribution; the old mirror continues preparing its captured private world without touching live counts.

    Do not call `getRefCounts(parent[key])` or inspect `parent[key]` directly where a mirror or cycle Error may change the counter contribution. A cycle cut is not followed by refcounting or given a reverse parent edge. The resulting counter graph is acyclic, so every ordinarily reachable node has exact `promiseCount`, `errorCount`, and parent maps; no cyclic counter propagation is needed. The raw value graph remains cyclic and is traversed only by finite path operations and cycle-aware export. Counter copying derives every edge contribution and parent edge in the copy's new world rather than cloning source totals or cycle Errors.

    **Non-extensible metadata.** Both storage modes have identical behavior. In inline-property mode, `META_MAP` is the fallback for non-extensible values that need import attribution, cycle Errors, mirrors, or logical counters; `metaOf` and `ensureMeta` are the only access boundary. An own inline metadata record is checked first and remains authoritative if host code makes its node non-extensible after metadata was attached. Non-extensible nodes use ordinary exact counters, and Promises and Errors inside them are valid language data.

    **Queries and export.** Observational path resolution keeps ordinary properties and captured mirrors on separate paths. At the terminal it passes only the raw value, import boundary, cycle Error, and whether that Error is still private; callers never receive an optional mixed placement record. A terminal cycle Error answers the error queries, while export follows the raw logical target through its cycle-aware path. Path resolution itself ignores the Error: a longer path can deliberately cross a cyclic property and select a clean raw subpath. `lookupPath` continues to need only the raw logical value.

    Otherwise `hasError` needs no recursive cycle branch: the reached branch's `errorCount` includes every reachable ordinary Error and cached cycle Error. `getErrors` adds each cyclic property's cached Error once, then follows that property's raw logical value so Errors and promises hidden from the projected counters remain in its exhaustive result. One operation-local identity set spans counted and raw traversal, deduplicating repeated nodes and Error identities while different cyclic properties remain different results. Both queries preserve their existing issue-time promise frontier and never pin or mutate data.

    Counted error-query collection never mints a mirror. Ref-index preparation guarantees one already exists for every pending property in an indexed branch, so `collectErrorSearchWaits` uses a required-existing accessor and registers through `PromiseMirror.onResolve`; a missing mirror there is a fatal downward-closure/writeback invariant failure. The raw `getErrors` phase behind a cycle cut accepts counterless values and may create or reuse a mirror at its own FIFO position. A settled/drained mirror is consumed through its logical value and is not re-registered merely because its holder still physically contains the Promise.

    Item 18 replaces the counter-based export path with one immediate raw
    copy-or-collect traversal. Export consumes mirrors at its FIFO positions,
    recursively extends its own Promise frontier, preserves aliases and cycles
    on success, and returns the complete distinct Error set on failure without
    reading counters or adding an ownership mark.

    The cycle-operation contract is therefore explicit: lookup and mutation traverse the raw imported data; export of an acyclic subpath behaves normally; export of a cycle-containing value preserves the raw cyclic topology in its metadata-free copy; and `hasError`/`getErrors` report the cached per-property cycle Error. That Error is diagnostic rather than poisoning, so `hasError` may be true even though export succeeds. It cuts only refcount and error-query traversal, never the logical value seen by export.

    **Lookup, mutation, and COW.** Finite path lookup and mutation use logical mirror values but ignore cycle/Error metadata; they are safe on raw cycles because they never recursively scan the graph. Imported data is shared, so mutation COWs before its first language write and never changes the host object. COW remains path-copying rather than topology cloning: for `external.self = external`, assigning an unrelated root property produces a new root whose `self` still points to `external`, not to the copy.

    Cycle Errors are placement-specific and are never copied blindly to a new owner. Unchanged raw children retain metadata on their own nodes; every copied edge is recounted in its new placement. A cycle Error changes only when that exact logical owner/key placement transitions; changing a sibling edge does not trigger a global cycle rescan. Language mutation of imported data COWs, so copied placements are new and prepared without copied cycle Errors, while Errors on the physically unchanged external graph remain valid. Every missing copied key is defined as an own data property, so preserving an enumerable `__proto__` edge cannot invoke the legacy prototype setter. Replacing/deleting a cycle cut removes its `[0,1]` contribution only at commit. A mutation can repair or remove an existing cut; only imported host data exposed by imported preparation can create a new one. Later lookup, `hasError`, `getErrors`, export, and `verifyRefCounts` must all agree after unrelated COW, partial and complete repair, repeated cyclic path segments, deletion, and whole-boundary replacement.

    **Promise transitions.** The writeback consumer first prepares the source's resolved value as private mirror state; every following consumer prepares its advance on top of the preceding `mirror.currentValue`. These preparations ref-index each new value before it becomes available to the next FIFO consumer, but they neither attach it to the live parent nor change that parent's `[1,0]` contribution while the mirror drains. The final successful consumer performs one atomic live-edge commit only when the complete drain remained non-fatal. An extensible owned holder receives the final physical value only at this drain point, avoiding intermediate physical states; an external imported or non-extensible holder remains physically untouched.

    When an import continuation finds that the final Promise placement closes a cycle, it retains the raw prepared value in `mirror.currentValue`, stores the attributed Error in `mirror.cycleError`, and the final drain commits the indexed parent directly from `[1,0]` to `[0,1]` without attaching a reverse edge to the raw target. Do not install either the Error or cycle-closing value into an external or non-extensible property; an extensible owned holder may store the raw final value because its counter graph remains cut by the Error. Intrinsic cyclic properties inside a resolved object receive `meta.cycleErrors` entries during that walk. An earlier FIFO advance is included in classification and a later valid language advance may repair the edge; only the final prepared Error/value state contributes to the live parent.

    A mirror on an imported host holder remains authoritative after a valid drain: retain the original Promise in that holder while logical operations use `mirror.currentValue`. Physical ownership is read from `mirror.node` at drain time rather than inferred from import attribution. The mirror retains its boundary separately for attribution and later traversal. A retained off-path COW fork carries that boundary; an active path fork omits it because the walk carries attribution until it produces an owned copy. Both belong to a new runtime-owned holder and write their final drained value physically only if that holder is still extensible, as do assigned and other ordinary runtime-owned mirrors. Consequently imported and non-extensible data remain physically unchanged without a promise exception.

    Live, revoked, and forked mirrors use the same prepared-edge state. Revoked preparation receives the owner, key, and mirror explicitly, records each private raw value plus any cycle Error without changing former parent counts, and remains available to operations that captured it; its successful drain reaches zero but performs no attached-edge commit. A fork reads the source's prepared logical value at its FIFO position but prepares against the fork's own owner/key; an edge cyclic in the source need not be cyclic in the copy. Every later mirror advance goes through `preparePropertyTransition`, never an unchecked `currentValue` assignment. Overwrite/delete clears the live mirror only during its own committed edge swap; already-registered consumers continue draining the revoked mirror privately.

    **Coverage.** Integration coverage runs under both metadata modes and includes:

    - A language-owned wrapper with clean siblings and one cyclic imported child: raw lookup/mutation remain available, counter operations see only the child's boundary Error, and no host or wrapper property is replaced.
    - Eager preparation producing the same deterministic first-repeat cycle cuts before any query. Promise cases cover internal and captured-ancestor cycles in the same resumed full-preparation walk, a direct ancestor result, a fresh result containing an ancestor, a Promise entering a prepared island that reaches its captured ancestry directly or deeply, recursively nested Promises, and an earlier FIFO advance replacing the raw settlement before its preparation continuation classifies it. Live and revoked imported attachment cases assert one mirror-placement cut and no path-dependent cut on the destination.
    - Self-cycles, interlocking cycles, distinct cycles at different graph depths, several cyclic properties, cycles crossing direct import boundaries, and ordinary DAG aliases; assert nearest-boundary attribution, property names in messages, stable per-edge Error identity, distinct Errors for distinct properties, alias deduplication, and exact counts from every indexed node.
    - A pre-existing metadata-bearing identity reached by a new import is marked shared and receives a fixed-path check rather than full preparation. A synchronous DAG identity receives full preparation once and is marked shared at its repeat; the same identity reached across import calls or in a later Promise segment is likewise marked and checked against the new captured ancestry, even if counters were added while pending. Also assert that ordinary trusted ref-indexing alone allocates no imported preparation state, while compiler lowering and COW prevent `a.prop = a` from creating a duplicate or cycle in language-owned data.
    - `getErrors` recording each cycle cut and continuing through its raw edge, including an ordinary Error and unresolved promise visible only beyond that cut, while still collecting and awaiting relevant siblings. `hasError` remains immediately true from the cut while getErrors waits for its exhaustive result. In one same-position cycle test, assert the deliberate diagnostic distinction directly: both error queries expose the cycle while export succeeds with the raw cycle.
    - A failed/fatal overwrite preserving the old value, mirror, mark, counts, and parent edges.
    - One-stage helper ordering: same-promise value consumers retain registration order, and interleaved `resolveInitialValueOrPoison`/`resolveOperationResultOrFatal` consumers do not invert. Rejection conversion, conversion failure, and synchronous continuation throws retain issue 8's Poison/Fatal taxonomy.
    - Mirror-drain ordering: writeback, an advance, and a query registered on one promise run in order; a later operation issued from an unrelated microtask cannot overtake the advance; and a mutation registered during the settlement-to-writeback gap remains pending when a previously queued unrelated continuation issues a read. Assert that the read falls back through the mirror rather than using stale `currentValue` synchronously.
    - Counter visibility during that residual window: hasError/getErrors follow the mirror frontier while `pendingConsumerCount > 0`; ancestor `promiseCount` never transiently reaches zero, and the last consumer of a non-fatal drain applies exactly one delta to the final value/Error/nested-promise counts. Export independently captures that mirror at its own FIFO position without reading counters.
    - Already-drained mirror reads, including a final `undefined`, remaining synchronous; preparation, queries, COW, and export output materialization honoring existing mirror/edge state rather than the physical promise; later reads register no duplicate continuation. Also cover a consumer exposing another promise, re-entrant registration before the outer consumer returns, synchronous fatal completion retaining one count without publication, later queued consumers being unable to reach zero, and overwrite/delete while the old mirror drains privately.
    - Ordinary valid settlement in a nested external imported holder retaining the exact physical Promise property while logical operations observe its settled value; an assigned mirror and a COW fork carrying the same import boundary write only their final drained value while their language-owned holders remain extensible. `export` produces host-facing data containing the settled logical value and no runtime metadata.
    - Counted error-query collection reuses the mirror minted by ref-index preparation and reports a deliberately corrupted indexed branch with a missing mirror fatally; raw collection behind a cycle cut may create or reuse a mirror and recursively extend the query's wait frontier.
    - Raw export returning a metadata-free copy synchronously when no captured promises remain; waiting for recursively exposed promises even when they sit behind counter cuts; preserving self-cycles, multi-node cycles, DAG aliases, and clean siblings; and collecting every ordinary Error identity found anywhere in the raw walk.
    - Unrelated mutation, repeated cyclic path segments, overwrite/delete of cycle cuts, partial and complete repair, replacement of an imported boundary, and later observations; assert exact-placement cycle-Error invalidation, no sibling-driven cycle rescan, unchanged host data, and the path-copy topology.
    - Live, revoked, and forked imported Promise cycles, including a fork where only one placement closes the cycle and an earlier mirror advance that repairs or changes the raw settlement before import classification; preserve FIFO isolation and exact `[1,0]` to `[0,1]`/replacement deltas.
    - Non-extensible cycles, Promises, Errors, and enumerable own `__proto__` keys in both storage modes, including fallback metadata, live/revoked delivery, exact logical counts, and removal of every stale extensibility shortcut.
    - COW counter reconstruction, cycle-Error removal, parent-edge multiplicity, verification termination, successful re-indexing after repair, and proof that no reverse edge crosses a cycle cut or ordinary Error value.
    - Oracle lockstep: `verifyRefCounts` recounts a draining live mirror as `[1,0]` rather than its physical or prepared value, and a deliberately committed parents-graph cycle is reported fatally by the oracle instead of being silently traversed — these land with slice 1, before any cycle-Error machinery exists.

    The implementation and architecture documents use the compiler-trusted no-cycle-checking contract for non-imported data and consistently describe the rooted `src/import.js` boundary, truthy attribution contexts, one-stage promise wrappers, mirror draining, logical reads and plain copying, property-level first-repeat cycle Errors, external-holder settlement, projected counters, scoped query coherence, and cycle-aware export.

    **Implemented cleanup addendum, slice 1: one cycle-Error representation.** Imported preparation has no staged graph or edge records. Its direct DFS reads each logical placement once per synchronous segment, reuses or creates the placement's promise mirror, and publishes a cycle Error when the target is on the current path. There is no parallel target, promise-placement flag, marker lookup, or imported preparation cache.

    One attributed cycle Error is stored directly in `meta.cycleErrors[key]` or `mirror.cycleError`. Presence means the projected edge is cut and contributes `[0,1]`; `hasError` and `getErrors` expose that Error, while export follows the raw cyclic data. Distinct cyclic properties still own distinct stable Error identities.

    Each DFS segment treats an existing committed cycle Error as a cut. It publishes a new Error as soon as an unmarked edge points into the current path; the common commit path ignores any later duplicate discovery until a real value transition clears the Error, preventing duplicate deltas and preserving first attribution. After the synchronous prefix, ordinary ref-index construction walks the committed projection from the root. Each FIFO preparation consumer resumes the detached DFS with its copied ancestry before later mirror consumers run. Cutting only back-edges preserves projected reachability, while ordinary structural edge processing retains exact alias multiplicity.

    Cycle-Error storage deliberately retains public and captured-state read paths. `getCycleError(owner, key)` reads the Error currently published by the property: from META for a plain property, from a drained mirror, or nothing while the mirror remains pending as `[1,0]`. An operation that captured a mirror reads `mirror.cycleError` directly and may observe its private prepared Error before drain. A mirrored property stores its Error exclusively in `mirror.cycleError`; installing or removing the mirror keeps `meta.cycleErrors[key]` absent.

    Preparation is operation-local. Its narrow dependency boundary is the generic ref-index commit plus the generic atomic live-edge commit: import owns orchestration, DFS visitation, mirror creation, and cycle detection, while refcounting owns only counter publication. The private rooted preparation returns nothing. It deliberately has no rollback layer: a failure during preparation is fatal and ends runtime execution.

    **Implemented cleanup addendum, slice 2: one atomic live-edge commit.** Every live assignment, deletion, changed mark installation/removal, and successful mirror drain uses one internal synchronous bookkeeping primitive. It first snapshots the old effective counts and counted child, then performs the already-validated placement-specific value/mirror/mark update, reads the resulting projection through the same cycle-aware accessors, swaps the reverse edge, and propagates exactly one delta. A final mirror drain decrements to zero inside that placement update, after the old pending projection is captured and before the final projection is read. Expected property-shape failures occur before entry, so a failed placement update leaves counter bookkeeping untouched. Here atomic means one non-interleavable live transition and one count delta, not rollback from an internal fatal error.

    Preparation and revoked/private mirror updates remain outside the atomic primitive because they do not mutate a live indexed edge. An unindexed live owner may use the same entry point, which performs only its placement update because no counter graph is attached. Do not turn this into a generic graph framework: it owns only the invariant shared by attached owner/key transitions.

    The full inline and WeakMap suites cover a draining mirror whose private cycle Error is visible to its captured continuation but not to parent counts; replacement, reuse, clearing, and deletion of committed cycle Errors; and exact deltas through aliased parent-edge multiplicity. Superseded helpers, side tables, paired fields, and prepared count snapshots are removed, and `README.md`, `docs/runtime-spec.md`, and `docs/counters-implementation.md` describe direct `cycleErrors`.

13. **Implemented: uniform non-extensible node support.** Frozen, sealed, and otherwise non-extensible objects are ordinary tracked nodes. They are implicitly shared, store runtime metadata through the WeakMap fallback, and participate in the same lazy ref index as extensible nodes. Import prepares cycles and Promise continuations eagerly, but only a counter-based operation pays to index the reached branch.

    Error values and own enumerable `__proto__` data properties remain ordinary language data. A Promise placement is valid only while it is an own enumerable writable data property because its first resolver publishes the prepared value physically. Writable properties on sealed or `Object.preventExtensions` holders are supported; a frozen or otherwise non-writable Promise property is a fatal host-contract violation. Ordinary frozen data without such a Promise placement remains valid. Language assignment and deletion still COW through non-extensible parents before writing.

    No non-extensible-specific META or mirror field exists. The COW predicate derives their implicit sharedness, `markShared` leaves them unchanged, and inline metadata storage falls back to the same WeakMap used by explicit WeakMap mode. Imported preparation ensures META only as required for preparation; other operations add metadata only for boundaries, counters, mirrors, cycle cuts, active read entries, or explicit shared marks.

    **One counter invariant.** After `buildRefIndex` succeeds, every raw-reachable tracked value has a counter regardless of extensibility. A cycle cut contributes its own count and omits the crossing reverse edge, while its raw target starts an independently indexed component. Error queries remain counter-fenced across every component, and export remains a counter-free raw walk.

    Required-counter checks enforce downward closure for Error queries, Promise continuations, verification, and live reverse-edge bookkeeping. An indexed Promise property must already have its matching mirror; an unindexed trusted or already-prepared derived property may create one lazily. The first resolver prepares and indexes an entering tracked value before a live physical publication, while a detached resolver updates only its private property version.

    `Object.isExtensible` has two semantic roles: selecting metadata storage and deriving implicit shared/COW behavior. Promise publication instead validates the actual property descriptor immediately before writing. Own accessor, non-writable, non-enumerable, and non-configurable descriptor rules remain independent of object extensibility.

    The demand-driven tradeoff is deliberate: querying a non-extensible branch allocates metadata, counters, mirrors, and reverse edges just like querying a mutable branch. Coverage under both metadata modes includes frozen ordinary data, synchronous Errors, writable Promise properties on sealed and non-extensible holders, fatal frozen Promise-property validation, arrays, aliases, cycles, lazy indexing, exact counter transitions, COW assignment/deletion, and verification.

14. **Implemented: in-place consolidation cleanups.** Imported cycle traversal uses explicit plain-property and captured-mirror entry paths, so no optional `{ parent, key, mirror? }` record or mixed cycle resolver remains. `prepareImportedData` owns growing-path discovery with durable META identity and one per-segment weak set. META-bearing repeats and imported attachment use one private fixed-path scanner; the attachment entry captures only the applicable copied ancestry, and only assigned pending attachment pins its root. `onImportedPromiseResolve` receives the exact mirror, and observational path resolution reduces its two internal paths to the cycle facts callers need. Counter-based observations index only the value delivered by path resolution. The full suite covers the result under both metadata modes.

15. **Implemented: operation module separation.** `src/index.js` is the small public facade and re-exports `Chain` from `src/chain.js`. `src/init.js` owns the cycle-breaking runtime wiring shared by the package facade and internal entry points. Public signatures and operation ordering are unchanged.

    - `src/mutations.js` owns assignment, deletion, mutation-path walking, shallow COW, Promise forks, and mutation-only property helpers.
    - `src/observations.js` owns lookup, export, `hasError`, `getErrors`, observational path walking, indexed Error dispatch, and the counter-fenced Error-search traversal. `walkObservationPath` is exported only for internal entry setup; its other walkers and operation-local state remain private.
    - `src/raw-walk.js` is the identity-aware primitive for metadata-free export copying and exhaustive export Error collection.
    - `src/import.js` owns graph preparation, `src/property-transitions.js` coordinates physical property state, and `src/refcounts.js` owns counters and the atomic accounting wrapper around indexed updates.

    Neither operation module depends on the other or on `src/index.js`; both depend only on lower-level runtime modules. Each subsystem keeps its own identity policy, and no generic visited/deduplication helper is introduced.

16. **Implemented: `PromiseMirror` lifecycle and `export` terminology.** **Promise mirror** is the canonical term: one internal `PromiseMirror` identifies one Promise-backed property version. `src/promise-mirrors.js`, `meta.mirrors`, and the create/get/install/fork helpers retain that vocabulary. Local code uses `mirror` where the type is clear and role-specific names such as `sourceMirror` or `propertyMirror` only when several mirrors have distinct jobs. Ordinary properties use parent/key directly, while suspended operations retain the exact captured mirror.

    The class has stable identity and survives detachment while captured resolvers finish. Its narrow lifecycle methods are `isLive(parent, key)`, `getValue(parent, key)`, and `detach(parent, key)`. A live mirror reads the physical property; detachment captures that property in the lazily created `detachedValue`. Promise registration, value preparation, cycle cuts, counters, parent edges, import scanning, and COW remain with their owning modules.

    ASSIGN, DISCOVERY, and FORK retain separate creation factories because they establish different birth ordering and source semantics. There is no generic state enum: liveness is derived from exact mirror-map identity, and pending state is derived from whether the authoritative live or detached value is a Promise.

    The language operation is named `export`. Because `export` is a JavaScript keyword, its implementation is `exportValue`; `src/index.js` exposes it through the native ESM alias `export { exportValue as export }`, and namespace callers use `runtime.export(...)`. The operation returns directly when its complete raw frontier is available, returns a Promise only when captured Promise values remain, produces metadata-free copied output on success, and returns one outer Error carrying the complete Error identity set on failure.

    The complete suite runs under inline and WeakMap metadata modes, with focused coverage for live and detached Promise property versions before and after their first resolver.

17. **Implemented: cycles are valid data.** Boolean property/mirror cuts replace the attributed cycle Errors described by the earlier implementation steps, and exact propagated `cycleCutCount` completes the counter triple used by Error queries. The cut count propagates because observations can start above an imported cyclic branch, and it decrements when the final reachable cut is repaired. Counters describe one persistent placement-based projection rather than a projection per import root. One build indexes every raw-reachable tracked value as cut-separated components: a cut contributes its own count and no reverse edge, while its target receives an independent index. After conclusive Error fast paths, queries use all three counters and one fenced traversal across those components. Export always uses one marker-independent raw copy-or-collect walk and does not inspect the projection. Verification checks exact triple counts, complete raw-reachable counter coverage, cut/property validity, mirror/plain exclusivity, and stale-cut removal. Full design: `docs/cycles-as-data.md`.

    Cut selection is coverage-based rather than duplicate-based. An existing cut suppresses another marker only when it lies on the exact active cycle segment; a prefix cut before the repeated identity does not. Fresh detached preparation keeps the closing back edge for each uncovered cycle so prepared identities remain safe under other roots and aliases, while fixed-path island and attachment scans keep their proven entering-placement cuts. The runtime does not attempt global rootward coalescing or a minimum feedback-edge set.

18. **Implemented: export returns the complete Error set.** Export starts one raw
    copy-or-collect walk at its captured path position. One operation-local
    `visited` WeakSet spans the full walk. While copying, a `copies` WeakMap
    reconstructs aliases and cycles; the first ordinary Error drops that map,
    while the export shell clears its root-copy reference. One Error Set and
    explicit `copying` flag are shared by the synchronous walk and every
    recursively exposed Promise continuation. Export's first ordinary Error
    disables all later output allocation and writes while traversal and Promise
    capture continue until the Error Set is complete. Error queries use their
    separate counter-fenced state and never enter this raw walker.

    Promise continuations register through captured mirrors as soon as export
    reaches them, so earlier consumers are included and later consumers through
    the same path are excluded. The no-pin design relies on the compiler/import
    ownership invariant: every alternate alias is shared and therefore COWs
    before a later write, imported host data is not mutated after import, and
    non-sharing lookup never exposes a still-captured value to mutable host
    code. One mirror-acquisition policy covers path and raw traversal: export
    may install a mirror on an unindexed pending property, but a missing mirror
    under an indexed owner remains fatal.

    Export needs no ref index, subtree settlement generation, shared mark, or
    COW pin. The final META schema drops the export-only settlement fields and
    `applyCountDelta` has no settlement branch. Cycle cuts remain topology and
    contribute no Error. Data Errors retain the same distinct-identity scope as
    `getErrors`; separately minted path-access Errors agree structurally rather
    than by identity, and Error-array order is not semantic.

    A successful result returns directly. Failure returns a fresh non-thenable
    outer Error with message `export: branch contains errors`; its `.errors`
    array contains every distinct reachable Error identity. Both the synchronous
    walk and aggregate readiness use the fatal boundary. Full design:
    `docs/export-error-set.md`.

19. **Implemented: live-property Promise mirrors.** Use one direct
    state rule: while a mirror is live, its physical parent/key property is the
    authoritative evolving value; after the mirror is detached, its lazily
    created `detachedValue` is authoritative. A mirror is live only while the
    parent's mirror map contains that exact instance.

    Runtime state is derived rather than stored:

    | State | Authoritative value | Placement cut | Import boundary |
    | --- | --- | --- | --- |
    | live, pending | physical property is the Promise | none | mirror |
    | live, resolved | physical property is the latest value | parent META | cleared |
    | detached, pending | `detachedValue` is the Promise | none | mirror |
    | detached, resolved | `detachedValue` is the latest value | none | cleared |

    "Resolved" means the first resolver has completed its synchronous
    transition. The source Promise may already be physically settled while that
    resolver is queued, but the runtime state is still pending because the
    authoritative location still contains the Promise. There is no
    live-resolved state whose authoritative value is a Promise.

    **Property-version lifecycle.** The first operation to reach an unmirrored
    Promise property creates and installs the mirror and synchronously registers
    that property version's first `.then`; call this its *first resolver*.
    Every resolver captures the Promise, parent, key, and exact mirror at
    registration time. The first resolver alone consumes the raw settlement
    payload, prepares it, performs any operation-specific synchronous work, and
    publishes the resulting state. If the mirror is still live it writes the
    physical property; otherwise it writes `detachedValue`.

    Lazy discovery remains necessary for trusted object literals, initial Chain
    values, assigned subgraphs containing nested Promises, and derived Promises
    returned by `import`. An unindexed owner may therefore create a mirror at
    first reach. A Promise below an indexed owner must already have its mirror;
    absence there is fatal downward-closure corruption.

    Later resolvers use the source Promise only as a FIFO readiness signal.
    They ignore both its fulfillment payload and rejection reason, read the
    latest state through `mirror.getValue(parent, key)`, and synchronously apply
    their own operation to that state. A later mutation may publish `V'`, `V''`,
    and so on, but it never seeds again from the original settlement payload.
    Pure lookup, export, and Error-query resolvers only read; they do not
    recommit unchanged state.

    `PromiseMirror` stores no `promise`, `node`, `key`, `currentValue`,
    `pendingConsumerCount`, or resolved flag. It keeps only state unavailable
    from a live placement: the unresolved `importBoundary`, plus optional
    `detachedValue` created on detachment. Keep
    `isLive(parent, key)`, `getValue(parent, key)`, and `detach(parent, key)` as
    narrow lifecycle operations. Remove `isDrained()`,
    `PromiseMirror.onResolve`, `commitMirrorDrain`, and all draining state.

    A live mirror remains installed after its first resolver replaces the
    physical Promise with a value. Already-registered resolvers need that exact
    property-version identity even though synchronous operations now see an
    ordinary value. Only replacement, deletion, and same-Promise reassignment
    remove it; there is no settlement-time mirror cleanup. Those operations
    detach the old mirror inside the same `commitLiveEdge` update that replaces
    the property, after the old refcount state has been captured and before the
    physical write. `detach(parent, key)` captures the old physical value as
    `detachedValue`, discards any live placement cut, and removes the mirror-map
    entry. Operations that already captured the mirror then continue against
    their private value, while the new property version proceeds independently.

    **Reads and cuts.** Ordinary `readLanguageProperty(parent, key)` is a purely
    physical own-enumerable read and never consults mirror state. Mirror
    acquisition runs only when that physical value is a Promise; a synchronous
    operation on a resolved physical value ignores the retained mirror.
    Lifecycle code that replaces a property still looks up that retained mirror
    so it can detach it correctly. This removes the metadata and mirror-map
    lookup from every ordinary property read in mutation, ref-index, export, and
    Error-query walks.

    `getValue(parent, key)` reads the physical language property while the
    mirror is live and `detachedValue` otherwise. Live cycle cuts use the
    ordinary parent-META `cycleCuts` set. A detached placement is absent from
    the indexed graph and retains no placement cut; intrinsic cuts inside its
    tracked value remain on those nodes. Every state-changing live resolver
    replaces the previous parent-META cut state, clearing an obsolete cut unless
    preparation reports one for the new value. A newly created mirror has no
    detached field; `detachedValue` is added only when an already-issued resolver
    retains a displaced property version. Remove `hasPublishedCycleCut`,
    separate plain/mirror cut setters, and mirror/plain live-cut exclusivity.

    A physical Promise and a published parent-META cut are mutually exclusive.
    Pending publication clears any old cut before installing the Promise, and
    resolving publication replaces the Promise and cut in one transition. The
    refcount verifier checks this invariant.

    **FIFO command contract.** Every operation processes its synchronously
    available path immediately. The helpers canonicalize every callable
    thenable once to one native Promise. When an operation reaches that value,
    it registers directly on the shared canonical Promise at its issue position
    and its resolver later performs its complete state transition synchronously.
    Same-Promise reactions therefore evolve one property version in order: the
    first resolver produces `V`, and later mutations/readers observe `V`, `V'`,
    `V''`, and so on. A reader issued after an earlier resolver completed reads
    the physical value synchronously; one issued while the property still
    contains the Promise registers behind every already-issued resolver.

    When one canonical Promise settles, JavaScript enqueues all reactions
    already registered on it as one contiguous FIFO batch. Another Promise's
    reaction runs before or after that batch, never between its entries, and a
    reaction registered after settlement joins the tail. The one-reaction helper
    rule is therefore load-bearing: a separate per-consumer proxy would fragment
    the batch and invalidate the ordering argument.

    This relies on the Cascada command runner issuing operations in program
    order. Calling kernel operations from unrelated host microtasks while an
    earlier same-Promise reaction is queued is outside the language-lowering
    contract. The old settlement-gap fast-path test represents that broader
    host-call model and is removed. Immediate registration, same-Promise FIFO,
    and synchronous resolver bodies remain load-bearing.

    **Rejection handling.** The first resolver uses the one-reaction
    `resolveInitialValueOrPoison` helper, which converts a rejected data Promise to one
    language Error for that property version before running its callback.
    Conversion or callback throws remain fatal. Later resolvers use
    `onLaterPromiseReady`, whose fulfillment and rejection branches both ignore the
    raw result and run the callback through the fatal boundary. It returns the
    derived Promise from that one reaction; export and Error-query callbacks may
    return nested readiness, preserving their hierarchical `Promise.all` trees.
    All three helpers register on the callable thenable's shared canonical
    native Promise. Later resolvers observe the Error already published by the
    first resolver. A fork first resolver uses the same readiness behavior
    because it samples the source mirror's prepared state rather than converting
    the source rejection again.

    **Import sequencing.** External data reaches the runtime only through
    `import`, so import is the first operation to reach every previously
    unprepared external Promise placement. Import creates the mirror and owns
    its first resolver; no generic writeback is registered before it. That
    resolver retains the imported placement's copied ancestry, performs full
    preparation and cycle discovery, gives a resolved tracked value the direct
    boundary needed by later synchronous traversal, and only then publishes its
    final value and placement cut.

    A later attachment of an already imported pending branch needs no second
    asynchronous classifier. If its eventual value creates a cycle through that
    attachment, the cycle must re-enter the pending placement's owner or another
    ancestor retained by its original import resolver; that resolver discovers
    the back-edge before publication. If the imported value is already
    available, attachment checking is synchronous. Fixed-path work therefore
    runs either synchronously on an available value or as birth-time preparation
    owned by a fresh property version, never as a later resolver that delays an
    existing mirror.

    Assignment, same-Promise reassignment, and COW fork create fresh property
    versions. Their first resolvers capture their own destination ancestry.
    A fork waits at its FIFO position, reads the source mirror's current
    live/detached state, derives import attribution from that sampled value
    rather than provisional creation-time state, marks a retained off-path
    tracked value shared, performs destination-specific cycle preparation, and
    publishes once. A Promise returned by a root import is already prepared
    before that derived Promise settles; assigning it still creates a fresh
    destination property version whose first resolver owns attachment checking.

    `importBoundary` exists only while the property version is unresolved. It
    belongs to the mirror rather than the whole parent because one owned COW
    node can retain pending properties from different imported boundaries. The
    successful first transition clears it for both live and detached mirrors.
    A resolved tracked value carries any continuing direct boundary in its own
    META; a primitive, Error, or operation-produced owned value needs none.
    Later operations derive import state from the current value or their own
    synchronous destination context and never overwrite a pending mirror's
    boundary with context from a later FIFO position.

    This sequencing removes both `importPreparationRegistered` and any need for
    `pendingPreparationCount`: there is no generic raw writeback followed by a
    separate import classifier, and no unprepared value is ever published.

    **Atomic transitions and counters.** A live resolver computes its final
    value and placement cut before publication. One `commitLiveEdge` transition
    writes both while retaining the exact mirror-map entry, then derives the new
    counts. The old physical Promise contributes `[1, 0, 0]`; the prepared
    replacement contributes its actual Promise/Error/cycle-cut/child counts.
    Any entering tracked child is indexed before the physical write, and reverse
    edges plus propagated deltas change atomically with it. Later
    state-changing resolvers perform the same exact transition from the current
    physical state.

    A detached resolver changes only `detachedValue`; it never updates its
    former parent's property, cuts, counters, or reverse edges. If that owner
    was indexed, the resolver prepares/indexes the detached branch before an
    earlier Error query consumes it. Verification derives live state solely from
    the physical property and parent META: a physical Promise counts as pending,
    a live cut counts as a cut, and an ordinary value contributes normally.
    Detached mirrors are absent from the indexed graph.

    **Physical-write requirement.** A live mirror is valid only while its
    property exists as an own enumerable writable data property. Discovery of
    an existing Promise property validates that complete descriptor before
    installing a mirror. Assignment to a missing key instead uses the ordinary
    property transition, which creates the valid data property and installs its
    fresh mirror atomically. Immediately before every later live resolver write,
    require the property still to exist with the complete valid descriptor: a
    missing property, accessor conversion, non-enumerability, or loss of
    writability is the same fatal host-boundary violation. Existing writable
    properties on sealed or otherwise non-extensible holders remain valid
    because replacing their value is legal. Ordinary non-Promise frozen data
    remains supported. Writable imported Promise properties receive their
    resolved physical values, so import transfers settlement ownership of those
    properties to the runtime. Host-facing output still goes through `export`.

    Removing `mirror.promise` deliberately removes the old
    different-Promise identity check. Required acquisition still reports a
    missing mirror below an indexed owner fatally. All valid replacement,
    deletion, and same- or different-Promise reassignment goes through the
    atomic transition that detaches the old mirror and installs a fresh one;
    direct host mutation after import is outside the runtime contract, so the
    source Promise is not retained solely as a corruption detector.

    **Coverage and cleanup.** Tests cover root and nested Promises; callable
    thenables sharing one canonical native Promise; fulfillment and rejection
    conversion exactly once per property version; first-resolver import
    preparation; same-Promise FIFO mutation/lookup/Error-query ordering;
    a live resolved mirror remaining installed for later queued resolvers;
    overwrite and deletion before and after first resolution; same-Promise
    reassignment as a fresh property version; COW fork divergence, sampled
    attribution, retained-value sharing, and destination-only cycles; detached
    indexing for an earlier query; attachment of an existing pending imported
    branch without a second classifier; synchronous resolved attachment; an
    indexed placement cut committed with its resolved value; two pending
    properties with different boundaries on one owned COW parent; writable
    sealed holders; rejected accessor/non-writable imported Promise properties;
    a property deleted or changed to an accessor/non-enumerable/non-writable
    descriptor after mirror creation; resolved `undefined`; live cut replacement
    and repair; detached resolution retaining no placement cut; and both
    metadata storage modes. Tests
    assert observable state rather than removed drain fields. README, runtime
    specification, import preparation, counter design, verifier, and
    implemented-step descriptions define the same live/detached model.

20. **Implemented: data-class copy-on-write.** `registerDataClass(Class)` permanently adds the constructor's exact prototype to a private `WeakSet`; registration must happen before instances enter Cascada, is not inherited, and does not modify the prototype. Registered classes assert that all relevant state consists of own enumerable string-keyed data properties. A COW shell retains the registered prototype without invoking a constructor, and the ordinary property pipeline rebuilds ownership, Promise mirrors, cycles, and refcounts.

    The private factory first handles every real array, including subclasses and cross-realm arrays, by returning the existing same-length local ordinary-array shell; subclass prototypes and methods are normalized away. It then returns `Object.create(null)` for a null prototype, `{}` for a plain object from any realm, `Object.create(proto)` for a registered non-array custom prototype, and no shell for any other prototype. Plain-object shapes are recognized structurally from the intrinsic prototype's own constructor back-reference, preserving pre-step-20 cross-realm behavior. Supported class fields must be own enumerable data properties and accept normalization to enumerable writable configurable data properties, but registration is trusted: the existing `readLanguageProperty` path is unchanged and no per-field descriptor validation is added.

    Unregistered classes and native internal-slot objects retain identity as untracked leaves: they may be assigned, returned, and exported, but graph operations do not traverse, copy, index, or attach metadata to them. A path cannot enter an opaque value, and `run` cannot use one as a receiver. Reflection or proxy throws remain fatal. False registration of private, hidden, accessor, closure, shared, or native internal-slot state is a host-contract violation rather than something the runtime tries to detect.

    Registered prototype methods survive COW and may use step 23's trusted read-only invocation. Mutating class methods remain deferred. Registered instances export as plain data; opaque values export unchanged. The complete contract is [`data-classes.md`](data-classes.md).

21. **Implemented: entered path ownership.** `enter(chain, path, mutates, onEntered)` validates the exact Boolean compiler fact and callable callback, selects an encapsulated mutating or read-only entry-setup path inside `src/enter.js`, and invokes `onEntered` exactly once only after successful entry setup. Mutating entry resolves the owning path through `walkMutationPath`; read-only entry resolves the complete value path through `walkObservationPath`. `enter` supplies the mode-specific callbacks, while each walker owns traversal and Promise-mirror registration. `onEntered` may run the operation synchronously or return its Promise; every consumer returns the operation's direct result or a Promise defining its complete lifetime. `enter` keeps the Chain active across that Promise. Scope completion prevents new operations through the entered Chain; read-only completion releases its read entry, while mutating completion starts or arranges publication through the gate. The API exposes the operation result after scope completion, independently of publication, or an entry-setup Error. Once a mutating target's owning parent is available, the terminal installs a fresh gate through the ordinary assigned-Promise transition. A direct target—including an Error or missing `undefined`—is recorded until graph reconstruction finishes, then becomes the private Chain root. For a Promise-valued target, the terminal creates the private Chain immediately with the source Promise in `state.value`, installs the gate to detach the source mirror, then installs a transfer mirror whose sampler registers through `onLaterPromiseReady` before the callback or any later command can run. After reconstruction, `onEntered` runs without waiting for the target. Target-independent work therefore overlaps target resolution, while target-dependent Chain commands register behind the transfer sampler on the same canonical Promise and observe the prepared logical value after every earlier effect. The existing mutation walk changes its boundary to `walkMutationPath(chain, ...)`, requires `chain._state.mutates === true`, derives the stable state holder internally, and accepts one optional completion callback. Each recursive frame receives a synchronous `writeBack` continuation instead of returning a reconstructed node. A target or entry-setup Error writes through every applicable enclosing frame before invoking completion. A Promise branch registers at its exact position, writes its current parent back immediately, and returns the existing helper Promise only when completion is requested; its reaction returns the resumed walk, so normal assimilation composes every ancestor frontier and the final operation result without a sentinel, explicit readiness Promise, dual node/result channel, `{ node, result }` record, or second reaction on one source. Ordinary assignment and deletion omit completion and retain their fire-and-register behavior. A Promise-valued target itself adds no setup frontier. `runOperationCallbackOrFatal` invokes `onEntered`, completes a direct result synchronously, or canonicalizes a returned thenable once; Promise fulfillment completes the scope and forwards the value, while rejection aborts the scope before fatal reporting. Publication proceeds independently through the installed gate. Consumers registered later on an ancestor run after gate installation and traverse the gate; earlier registrations retain their positions. Either mode returns a direct operation result when setup and the callback are synchronous; delayed ancestor setup or an asynchronous callback produces a Promise. No second walker, persistent location capability, pending entry-setup state or command queue on `Chain`, issuance-check bypass through a raw root holder, or source Chain/path retention after entry setup is added. When owning-path COW leaves the target reachable from the old graph, a direct target is marked shared before `onEntered`, while a Promise target's transfer sampler derives the same rule from `attachmentPath` and marks the prepared value before later private consumers. No separate sharing Boolean is passed or stored and the raw Promise is never marked.

    Gate installation uses the mutation subsystem's ordinary assigned-Promise transition rather than a raw write. For a Promise target, setup obtains the source mirror, then `replaceProperty` synchronously detaches it and atomically replaces the old public edge's reverse-parent and counter contribution with the gate's pending-Promise contribution. `transferDetachedPromiseMirror` immediately installs an ordinary mirror on private `state.value` and registers its sampler at mutating `enter`'s FIFO position. No Promise reaction or later command can run between these synchronous steps. When reactions run, the source version's earlier resolver writes the prepared logical value to `sourceMirror.detachedValue`, and the transfer callback reads that field, applies the `attachmentPath` sharing rule, and writes through the transfer mirror. It therefore retains no source parent or key and never consumes raw settlement. A derived proxy Promise is forbidden because it would move private consumers out of the source's FIFO batch. `setMirrorValue` later indexes and attaches the published root while removing the gate's pending contribution. A Promise target normally has no immediate count delta because both old and gate versions are pending, but the detached source can no longer affect the public edge. The private `_state` holder is not a language-graph parent and receives no reverse edge. `forkPromiseMirror` remains separate because a fork may sample a live source placement.

    By contrast, read-only entry setup installs no gate and uses `walkObservationPath` to resolve every Promise-valued path segment, including the target, before protecting the captured root and invoking `onEntered`. The walker invokes the resolution callback from its existing helper continuation and returns that helper Promise, while a target or path Error bypasses `onEntered`. If the walker supplies an inherited import boundary, entry applies ordinary import preparation so the captured value becomes an independent direct boundary and commands through its Chain retain attribution without a sticky Chain field. Every tracked root increments `META.readEnterCount`, including one already protected by sharing, import, or non-extensibility; primitives require no metadata, and overlapping read-only Chains increment independently. This protects the captured root from mutations issued after acquisition until callback completion: those mutations COW, while earlier effects and Promise settlement remain part of the captured world. The callback may wait before issuing commands because its Promise retains the read entry. Observational native work receives the resolved identity under the same read protection, while kernel continuations issued before closure retain their ordinary captured-mirror FIFO semantics afterward, so enter adds no further outstanding-operation counter. Later traversals through a gated path wait through the existing mirror FIFO while unrelated paths continue; a direct later replacement creates a newer version immediately. Another mutating `enter` on an existing gate installs its transfer mirror and successor gate, invokes `onEntered` immediately, and leaves target-dependent work ordered at the predecessor mirror.

    After `onEntered` returns directly or its returned Promise fulfills, both modes call the entered Chain's one-shot `close()` method, which deletes `state.mutates` and prevents new issuance without cancelling already-issued work. `new Chain(value, mutates = true)` validates and stores that exact Boolean capability, so entry creates its private Chain directly without entry-specific construction or closure helpers. Read-only completion then releases the exact value captured at acquisition and returns or forwards the operation result. Mutating setup retains the gate resolver lexically rather than storing the gate or resolver on the Chain. Completion stores the current `state.value`; if direct, it calls that resolver immediately, while a Promise value receives one `onLaterPromiseReady` callback that later reads `state.value` and calls it. The private-root mirror's transfer or assignment resolver and every earlier private operation precede that callback in the Promise's FIFO order, so they update the authoritative slot first. Root replacement is synchronous, and closure forbids later issuance, so no mirror lookup is needed for this stable slot; ordinary detachable graph properties still use their captured mirrors. Passing the stored Promise directly to the gate resolver remains forbidden because native assimilation would consume raw settlement, could invoke a callable thenable again, and could reject the gate. This readiness callback affects only publication, not the operation result or Chain lifetime. `enter` returns or forwards the operation result without waiting for the gate or its consumers. The operation result is never stored on the Chain, and no continuation is registered on the gate merely to delay it; result forwarding supports higher-level callback consumers without a separate result channel. Ordinary and mutating entered Chains use `mutates: true`, read-only entered Chains use `false`, and absence remains the sole closed-Chain authority. `close()` does not publish; `enter` retains automatic publication ownership. No lifecycle field retains the source Chain or captured placement. `setMirrorValue` globally rejects a Promise before import preparation, ref indexing, descriptor mutation, or publication; new Promise values must use `replaceProperty` and a fresh version. Mutating completion nevertheless keeps a local non-Promise assertion immediately before calling the resolver, protecting that boundary if raw compiler or host mutation bypassed the property transition. No suspended earlier-issued operation can install a later `state.value` version: root replacement targets the always-available private holder and runs synchronously when issued. Already-issued private continuations may remain suspended and operate on the eventually public graph through their existing mirrors, so no Chain-wide completion queue or recursive root readiness tree is added. Returning an inner mutating `enter` result naturally keeps an outer mutating operation active until the inner callback completes; the outer graph may publish with the inner gate still pending, and that gate preserves ordering without a LIFO stack or explicit cleanup branch.

    Import attribution remains version-local: pending mutating targets carry it in their source and transfer mirrors, while prepared tracked values—including read-only targets re-rooted from an inherited boundary—carry their own META boundary. The private Chain receives no sticky inherited boundary. The gate mirror carries the owning walk's normal imported-attachment preparer. Its ordinary Promise assignment permanently pins a fresh COW attachment root because private work may later publish imported data even when the current ancestry is clean. Repeated entries on such a path may therefore re-COW it; entries issued only after prior publication keep one live gate, while earlier issuance retains the ordinary gate backlog. An immediate Promise-target callback may finish before target readiness, so awaiting only operation results does not bound this backlog; doing so would require a separate publication signal. Avoiding the attachment pin would require either a static no-import guarantee or a temporary pin spanning every recursive import-preparation frontier.

    Chain capability is checked only at the shared observation- and mutation-walker issuance boundaries: observation accepts either exact Boolean, mutation requires `true`, and absence of `mutates` rejects new issuance; already-issued inner continuations do not recheck. Read-only entry uses the shared `metadata.updateReadLease` transition to increment the captured tracked value at acquisition and decrement it at completion, deleting its zero count; primitives need no metadata. `enter` and `run` each own and release only their own lease. Before either mode forwards a tracked result, its consumer applies ordinary ownership preparation: an identity with another language owner, including reachability from entered `state.value` at scope completion, becomes shared, while a wholly new result may be ceded to the caller. Every `enter` consumer owns that preparation. Only `enter` is exported internally from `src/enter.js`; its mode-specific paths, completion routines, and abort routines remain private. A non-Boolean `mutates`, non-callable `onEntered`, read-only/closed Chain misuse, invalid descriptor or publication contract, callback throw, or completion-Promise rejection remains fatal without changing existing path-operation result shapes. Callback throw or rejection first aborts the entered scope: both modes delete `state.mutates`, read-only mode releases an acquired read entry exactly once, and mutating mode leaves its gate unresolved rather than publishing potentially corrupted private state. The callback's Promise is a control-flow completion signal, not a data Promise; lowering converts expected data rejection to an Error value before that boundary, while unexpected rejection remains fatal. `onEntered` returning directly or fulfilling its returned Promise defines the entered scope's complete lifetime. Detached later issuance is a trusted lowering violation; a statically visible self-wait is rejected, while a dynamic self-wait remains a lowering deadlock. Automatic successful completion and abnormal closure remove caller-managed cleanup and normal gate-abandonment paths. The complete lifecycle, ownership, ordering, failure, deadlock, nesting, and test design is [`enter.md`](enter.md).

22. **Deferred: proxy-backed mutating class methods.** The runtime graph remains data-only, and step 23 does not permit arbitrary side-effecting class methods. If that capability is revisited, registered data-class methods execute against operation-local recursive draft proxies so ordinary JavaScript such as `this.x = 3` cannot mutate tracked state directly. Callback-based `enter` owns exact receiver capture, gating before argument waits, owning-path COW, private lifetime, supersession, and publication. The proxy subsystem owns normal JavaScript identity during the call, whole-receiver mutation validation, graph collection, minimal materialization, runtime-aware reconstruction, result translation, and revocation. The first viable subset remains synchronous, checked Promise-free receiver state with no private fields, accessors, internal slots, external side effects, proxy escape, or Promise draft writes. The deferred design is [`future/run.md`](future/run.md); [`future/run-draft-proxy-archive.md`](future/run-draft-proxy-archive.md) preserves its predecessor analysis.

23. **Implemented: restricted standard method `run` and `ArrayView`.** `run(chain, path, method, mutateArray, ...arguments)` invokes standard String and Array data-only operations and trusted read-only methods. The exact Array-mutation mode is supplied before settlement: observation-mode mutators return a distinct transformed logical Array, while mutation mode publishes the receiver and preserves JavaScript mutator results. A mutation request against a non-Array target replaces it with and returns a validation Error. String protocol hooks follow the same trusted read-only contract as their outer method. Side-effecting non-Array methods, constructors, Array callbacks other than sort comparison, and opaque receivers remain unsupported; opaque results pass through as identity leaves.

    Native intrinsics receive prepared arguments unchanged and perform their own coercion. Lowering captures arguments without exporting them. After dispatch, `run` exports only the positions that reach native code; value export accepts data independently of a Chain and may return directly or through a Promise. Standard operations do not export their logical receiver or elements. `push`/`unshift` values, `fill` value, `splice`/`toSpliced` insertions, and `with` value retain assignment identity; a Promise payload is installed with a fresh mirror rather than awaited. Identity searches retain the captured search value, and `concat` items remain logical values. A sort comparator is the sole executable argument: it may be direct or Promise-valued and receives resolved logical elements under a trusted pure contract. Its result and numeric conversion must be synchronous. A direct readiness set adds no Promise wrapper.

    Path delay and post-target preparation are separate. `walkObservationPath` resolves the complete receiver path, including a Promise-valued final target; `walkMutationPath` resolves only through the owning parent. `run` in mutation mode and Array length assignment call the ordinary mutation walker directly, then pass the reached property to `transformProperty`. That target helper captures the final property version, starts required argument preparation concurrently, and invokes a callback with the resolved value, prepared arguments, and copy-on-write context. Ready work publishes synchronously. Pending readiness installs an ordinary assigned-Promise receiver gate before returning and, when needed, exposes an independent result Promise; receiver publication precedes that result. A pending final receiver is sampled through its live or detached mirror after earlier FIFO operations, never from raw settlement. The operation callback owns no parent, key, mirror, gate, publication, or path-walking state. Normal language Errors publish unchanged or partial state whose completed edge transitions are already accounted for; fatal failures leave an installed gate unresolved. Native structural methods produce an ordered `arrayMutationRemap`: captured property versions map to destination indexes, raw values use ordinary assignment, and deletions and length writes use their ordinary mutations. Remapping prepares fresh destination mirrors; a live mirror is never relocated directly.

    Element-Promise preparation also follows the operation. `at` resolves only its selected property; identity searches keep their early-stop rules; structure-only operations do not resolve retained, moved, copied, inserted, or replaced values; `pop` and `shift` wait only for a removed-value result; `concat` and `flat` resolve only values whose type controls spreading; and sort and text conversion resolve only values they inspect. Default sort prepares strings for non-`undefined` values; both sort overloads use native stable sorting over prepared records and retain logical argument identity. A moved or copied Promise receives a fresh destination mirror. Array and String `length` become visible virtual properties; Array length follows `ArraySetLength`, while String length is read-only.

    `walkMutationPath` calls `requiresCopyOnWrite` while traversing to the receiver's owning parent; the first `true` causes that node and every remaining path node through the parent to be shallow-copied. At the receiver, observation mode, prior path COW, or `requiresCopyOnWrite(receiver)` means the current logical version must be preserved. Eligible `slice`, receiver-appending `concat`, `push`, `pop`, `shift`, and `unshift` derive an `ArrayView`; other cases use an owned native Array. Existing indexed receivers use method-specific edge deltas rather than affected-range snapshots. Stable `_start`/`_end` coordinates translate through a base offset in storage shared by every view. Each retained Promise property receives a mirror forked at view derivation even though its physical slot remains shared. A pending logical observation holds a read lease, while ordinary observation of a view uses a shallow materialized receiver. Complete contracts are [`run.md`](run.md) and [`array-view.md`](array-view.md).
