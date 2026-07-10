# Issues

## Subtree Counters

1. **Implemented: subtree counters replace the CLEAN flag.** `src/refcounts.js` now owns exact `promiseCount`/`errorCount` totals for ref-indexed branches. Ref-indexing is lazy and per branch; never-checked data pays zero counter bookkeeping. Existing writes/deletes go through counter-aware helpers, ref-indexed writes evaluate the bookkeeping gate at commit time, promise writebacks replace `[1,0]` with the resolved value's counts, and COW copies snapshot counters for the copied world.

    Implemented rules:

    - Ref-indexed regions are downward-closed: ref-indexing walks whole subtrees, and writes into ref-indexed parents ref-index the entering value before commit.
    - The ref-indexed gate is evaluated at commit time, never captured at registration time.
    - `parents === undefined` means not ref-indexed; an empty `Map` means ref-indexed root / no ref-indexed parents.
    - CLEAN is only derived: clean means `promiseCount === 0 && errorCount === 0`.
    - Ownership/COW stays mark-based; counters answer "what is pending/broken below me", and the SHARED mark answers "who else can see me".
    - Error values count as language errors inside ref-indexed branches.
    - Non-extensible frozen/sealed subtrees must not contain promises or Error values anywhere beneath them in the language-visible enumerable string-key graph. A frozen subtree is permanently `[0,0]` and carries no counter metadata. (Enforcement point moves from import screening to counting time under issue 4.)
    - Counter metadata, promise mirrors, and the SHARED mark share the single `META` record; `src/meta.js` owns generic metadata and `src/promise-mirrors.js` owns mirror lifecycle.
    - `normalize` is implemented by issue 6 and `hasError` by issue 7; they activate this ref-indexing at their public operation boundary.

2. **Implemented: single META record and accessors.** `src/meta.js` owns the one logical metadata record. Storage is selected by `STORE_META_IN_WEAKMAP`: inline non-enumerable Symbol property by default, or WeakMap. Shared marks, promise mirrors, and subtree counters all use that record, and `shallowCopy` never copies it as language data.

    ```js
    function createMeta() {
        return {
            shared: false,   // set once, never cleared; false at birth = "no mark"
            mirrors: null,   // lazy Object.create(null), the promise mirror map
            promiseCount: 0,
            errorCount: 0,
            settlementPromise: undefined,
            settlementResolve: undefined,
            settlementVerifyScheduled: false,
            importContext: undefined,   // issue 4: undefined = not imported; string = attribution
            // parents is added by buildRefIndex when counters become live:
            // undefined => not ref-indexed; empty Map => ref-indexed root / no ref-indexed parents.
        }
    }
    ```

    Implemented rules:

    - `metaOf(value)` returns metadata for tracked nodes in WeakMap mode, including frozen/sealed nodes; inline Symbol mode returns only an extensible node's own Symbol record, never an inherited record from a runtime object used as its prototype.
    - `hasSharedMark(value)` reads `metaOf(value)?.shared === true || !Object.isExtensible(value)`.
    - Promise mirrors live in `meta.mirrors`; `src/promise-mirrors.js` creates the map lazily as `Object.create(null)` and owns mirror lifecycle.
    - Counter fields live directly on META. `parents === undefined` remains the ref-indexing gate; record existence alone does not mean counters are live.
    - COW copies receive no copied META object. If counters are live, `copyCounters` creates a fresh META record and snapshots counts there.

3. **Implemented, superseded by issue 4: eager import boundary screening.** `screenImportBoundary(value, target?)` validated cycles, frozen-rule violations, own `__proto__` keys, and screened-writeback back-edges eagerly at the boundary, minted screened mirrors for every imported promise key, and re-screened resolved values at settlement. Issue 4 removes this machinery: import becomes a mark-only O(1) operation and validation moves to counting time. The parts that survive unchanged: ref-indexing walks whole subtrees, initializes counters bottom-up, registers parent edges, and mints a promise mirror for every promise-valued key (eager minting because ref-indexed regions are never rescanned; an orphan promise with no writeback would hold `promiseCount` up forever); traversal uses two-color marking (reaching a visiting node is a cycle; reaching a visited node is a DAG share and reuses its result).

4. **Implemented: lazy import marking and counting-time validation.** Full design: `docs/lazy-import.md`. `import(value, errorContext)` is mark-only: it stores the error/attribution context (a string in this sandbox; line/file/etc. in Cascada) in the META `importContext` field, sets the shared mark, and returns — no walk, no validation, no mirror minting. The errorContext is **required**: importing without one throws (fatal configuration/compiler error — an absent context would silently disable provenance propagation, since `importContext === undefined` is the "not imported" sentinel). Non-extensible imported values keep attribution in META under WeakMap storage, or in a scoped side table under inline Symbol storage, so attribution is durable for every outcome. Untouched imported promises are never resolved in place; external objects the program merely holds are never mutated. Validation collapses to a single pure `validateCountable(value, writeTarget)` used exactly where counting needs its guarantees — `buildRefIndex` (first `normalize`/`hasError`) and ref-indexed write commits (with the write-target back-edge check) — covering cycles, the frozen rule, and back-edges, with failures surfaced by operation semantics and attributed to the import context. An entering value pays exactly two passes (pure validate, infallible commit — the transactionality split); there is no third: `commitRefIndex` returns the committed totals and the write path uses them directly.

    Implemented changes:

    - Remove: `validateImportBoundary`/`validateImportValue`, `screenImportBoundary`, `scanImportedValue`, `getOrCreateImportedPromiseMirror`, `mirror.screenValue`, `IMPORTED_PROMISES`, `forbiddenPathError`/`FORBIDDEN_PATH_KEY`, and their tests.
    - Runtime writes stay plain `node[key] = value`; `__proto__` is forbidden as a language key. Lookup treats `__proto__` and own non-enumerable properties as missing; mutations through `__proto__` throw, owned non-enumerable properties throw, and shared/imported branches COW before the check so non-enumerables are shadowed as missing; counting rejects imported own enumerable `__proto__` keys; COW copy preserves such keys by pre-creating an own data slot before assignment.
    - META `importContext` + `markImported`/`nodeImportContext` (non-extensible imported nodes use META in WeakMap mode, or the side table then inherited context in inline Symbol mode; no generic fallback); mark-only `import`.
    - Marker propagation: lookup extraction (even with `sharedOwnership=false` — provenance is about origin, not aliasing), COW reuse (all tracked children including the path key), and mirror flavor (discovery, forks, and ref-indexing carry the context; writebacks mark settled values imported+shared before consumers observe them).
    - `validateCountable` in `src/validate.js`; wire into `buildRefIndex` (no target; may skip already-ref-indexed subtrees only in ordinary mutable context) and `refSetProperty` (target = written parent; no early exit on the descent). A non-extensible ancestor imposes the stricter no-promise/no-Error rule, so indexed descendants beneath it are revalidated. Validate-then-commit stays two-pass: a failure must leave no partial counters, edges, or mirrors.
    - Frozen data becomes graceful outside counting: lookup reads through a frozen holder's promise key mirror-free (no advance is possible, the raw settled value is the only version); COW of a frozen source seeds the fork mirror from the raw promise. Only counting rejects frozen-with-promise/Error.

    Deliberately accepted trade-offs: invalid imports fail at first counting use (permanently for that branch) instead of at the import site — the errorContext exists to point back; a back-edge writeback under a non-ref-indexed target commits and the cycle floats harmlessly in the uncounted region (all walks are path-bounded) until counting rejects it. Getter/proxy side effects are out of scope: a developer who mutates or counts exotic objects through Cascada must ensure they behave as plain data.

5. **Implemented: counter bookkeeping in write helpers.** Runtime property writes/deletes live in `src/index.js`; `src/refcounts.js` exposes `refSetProperty(parent, key, value)` and `refDeleteProperty(parent, key)` for counter-only bookkeeping. The module layers without circular imports: `src/helpers.js` -> `src/meta.js` -> `src/validate.js`/`src/promise-mirrors.js` -> `src/refcounts.js` -> `src/index.js` (validate and promise-mirrors both sit on meta; refcounts imports all three; `validateCountable` takes `isRefIndexed` as a parameter so validate stays below refcounts); promise mirror storage/birth lives in `src/promise-mirrors.js`, and `src/index.js` initializes mirror writeback with `initPromiseMirrors(setProperty)`.

    The refcount helpers never perform the language write/delete. If the written parent is not ref-indexed (`metaOf(parent)?.parents === undefined`), they no-op and return the original value. The gate is checked when the helper runs, so continuations registered before ref-indexing bookkeep correctly after ref-indexing.

    - `refSetProperty(parent, key, value)`: validate (issue 4) and ref-index an entering value when needed, subtract `getRefCounts(old)` and add the entering value's totals taken from the commit pass itself (promise `[1,0]`, Error `[0,1]`, tracked value the totals `commitRefIndex` returns, a validation failure an Error counted `[0,1]`), swap parent edges, propagate, and return the value that `src/index.js` should write.
    - `refDeleteProperty(parent, key)`: compute `-getRefCounts(old)`, remove the parent edge, and propagate before `src/index.js` deletes the key.
    - If a child's `Map<parent, edgeCount>` reaches zero for that parent, delete only that map entry; never delete the `parents` map itself.
    - Promise mirror lifecycle remains at operation sites: fresh mirror on promise assignment, guarded writeback, clear on overwrite/delete. A suspended advance stores the value returned by the guarded write, because ref-index validation may replace its candidate with an Error and later FIFO continuations must observe that committed value.
    - `shallowCopy` copies language keys, forks mirrors, then calls `copyCounters(source, copy)`. Ref-indexed copies snapshot counts, receive `parents = new Map()`, and register themselves as parent on reused tracked children.

6. **Implemented: `normalize` and settlement.** normalize is lookup-shaped: it resolves the path with lookup rules through the observational, context-threading `resolvePath`, then marks exactly what escapes plus any pending branch that must be pinned while it settles. It ref-indexes the branch on first use at the caller's program position and surfaces counting-validation failures as language values with import-context attribution (an Error return). It follows the kernel's value-or-promise convention: whenever the answer is decided before any suspension, it is returned synchronously. All internal waits go through the uniform wrapper in FIFO order — settlement waits are consumed through `onInternalResolve`, never a bare `.then` outside helpers. (These conventions are shared with `hasError`, issue 7.) Placement: the settlement-wait machinery lives in `src/refcounts.js` next to `applyCountDelta`, which fires its only trigger; `normalize` and `copyToPlainValue` are ops in `src/index.js`. `copyToPlainValue` is the third sanctioned write bypass (plain output data, no metadata to bookkeep) and carries the pinned comment like the other two.

    `normalize(chain, segments, sharedOwnership=true, plainCopy=false)` — resolve, ref-index, answer if settled, otherwise pin and wait:

    - Resolve the path with the observational, context-threading `resolvePath` (reused by hasError, issue 7): callers decide marking after resolution. The resolver threads importContext, both to flavor discovered mirrors and to attribute failures. An Error along or at the path returns that Error; an untracked target (primitive/null/undefined/missing) is returned as-is — no counting, no marks, no settlement wait. A promise along the way is continued through its mirror.
    - Ref-index the reached branch, passing the walk's inherited import context into `buildRefIndex` so a validation failure returns an Error attributed to the import site even when the branch carries no own marker. No mark is applied on failure.
    - **Mark exactly what escapes, plus mark to pin a wait** — `markImported` with context inside an imported region; otherwise `markShared` only when `sharedOwnership=true`, except pending normalize always marks to pin the wait. A settled `errorCount > 0` returns a single Error **unmarked** (only an Error escapes); a settled `plainCopy=true` returns the deep copy **unmarked** (the copy is independent and produced inside the synchronous prefix, so nothing can interleave with it; copies are born owned).
    - If `promiseCount === 0` already, the answer is synchronous: `errorCount > 0` → a single Error; `plainCopy=true` → the deep copy; otherwise mark according to `sharedOwnership` and return the branch. No settlement wait is ever created for a settled branch, so the zero-count wait case does not exist.
    - Otherwise mark regardless of `sharedOwnership` (the pin) and wait. The pin makes the wait-set exact: later-issued operations COW away from the marked branch, while suspended remainders of earlier-issued operations still land through in-place mirror advances — `promiseCount === 0` is precisely the promises present at the call plus promises recursively exposed by their resolved values. Do not collapse to Error until settlement, because an earlier-issued remainder may still replace an Error before zero; a branch that later collapses to Error keeps its pin mark, since the outcome is unknowable at call time.
    - `meta.settlementPromise` is one shared settlement promise generation and exists only while normalize callers are waiting; `meta.settlementResolve` holds its resolver; `meta.settlementVerifyScheduled` coalesces queued verification; the only wake source is the zero-crossing in `applyCountDelta`. Liveness holds because every decrement of the pinned branch's counters happens inside a continuation of one of its counted promises: later-issued operations COW away, and earlier-issued remainders ride counted promises — their writebacks and their COW installs at mirrored keys (which may remove counted promises without settling them) all run as continuations of promises the branch counts.
    - Snapshot exactness also leans on the compiler disciplines of issue 10 (import routing and single-owner lowering): a raw promise illegally shared between a location inside the pinned branch and one outside it could mutate the branch outside its counted wait-set.
    - Verification is registered through `onInternalResolve(Promise.resolve(), ...)` — no ambient settling record is needed: at the moment of the crossing every consumer already registered on the settling promise is already enqueued, so the verification runs after all of them; and any earlier-issued remainder still able to land in the marked branch must ride a promise physically counted `[1,0]` inside it, so a true zero means nothing earlier can still arrive. It never fires synchronously. On run, re-check and fire only if `promiseCount` is still zero; otherwise the next zero-crossing re-schedules.
    - On fire: `errorCount > 0` returns a single Error; `plainCopy=true` returns a deep copy through an old->new identity map consulted before recursing (preserving own enumerable `__proto__` data keys before plain assignment); otherwise return the already-marked branch.

    A non-extensible root never receives metadata or creates settlement waits: validate it with `validateCountable` and treat it as settled `[0,0]` — a violation returns the attributed Error, `plainCopy` copies it plainly, otherwise it is returned as-is.

7. **Implemented: `hasError`.** Implemented after normalize (issue 6), which it builds on: the counters, the settlement conventions, the non-marking context-threading `resolvePath`, and the ref-indexing walk already exist. `hasErrorAtPathValue` builds the generic ref index for each reached path result, then delegates indexed-branch probing to local `probeIndexedBranchForErrors(value, resolveError)` in `src/index.js`: it answers synchronous errors from `errorCount`, and collects promise waits only when `promiseCount > 0`. hasError owns the final boolean race and returns a boolean or a promise of one. It is a pure query with no shared settlement wait and no marks, and returns a bare boolean whenever the answer is decided before any suspension.

    Empty path probes the root itself. Non-empty paths resolve the **parent path** (`path.slice(0, -1)`) through `resolvePath` — this disambiguates the outcomes `resolvePath` collapses into `undefined`: at parent-path level a missing terminal IS the full path's broken intermediate, so an `undefined` or Error parent means a broken path (true); one `readLanguageProperty` on the final key then decides — missing → false, Error → true, promise → settle and probe, tracked → probe the branch. No extraction marking anywhere: only a boolean escapes (issue 4's lookupPath would mark; hasError must not, and unlike normalize it never marks the reached branch either) — while the resolution still threads importContext, because mirrors discovered along the way must be flavored: marking settled values is a settle-boundary obligation, not an escape duty. `__proto__` and own non-enumerable segments follow lookup semantics — read as missing, never throw.

    Deliberately no pin: marks are irreversible, so pinning for a boolean would permanently convert every queried branch to COW-on-write — a query must not change the program's write behavior. And the wait tree makes a pin unnecessary for exactness: the wait set is captured at issue time and extended only through resolved values read at hasError's own FIFO slots, so the answer reflects the issue-time branch plus its recursive exposures. Later-issued installs are simply invisible (the "original indexed frontier" test pins this); later-issued overwrite/delete can detach a watched promise's resolved value from the live tree, but the captured mirror still answers for the issue-time branch. This is the query contract. At the reached branch:

    - `hasErrorAtPathValue` first calls generic `buildRefIndex`. A validation failure returns true (invalid countable data is an error condition for a boolean query). Otherwise the branch is fully indexed, preserving the invariant that a ref-indexed parent never has a tracked extensible child without counters.
    - On the indexed branch, `errorCount > 0` -> true immediately (a counted error sits under settled positions; no earlier-issued remainder can remove it). `promiseCount === 0` -> false immediately (every earlier remainder rode a counted promise). Both are bare booleans.
    - Pending handling is the promise tree returned by `probeIndexedBranchForErrors`: after `buildRefIndex` succeeds and only when `promiseCount > 0`, it descends the ref-indexed branch through nodes whose counters still contain promises and pushes one wait per pending key: `onValueResolve(childPromise, () => probeResolvedPromiseForErrors(mirror.currentValue, resolveError))`. Registering waits after `buildRefIndex` is load-bearing: mirror writebacks are registered first, so hasError continuations observe `mirror.currentValue` after the writeback/mirror-storage step. `probeIndexedBranchForErrors` returns `Promise.all(waitPromises)`, and hasError returns `Promise.race([errorPromise, onInternalResolve(cleanPromise, () => false)])`.
    - Each settlement continuation probes the captured mirror's `currentValue` through `hasErrorAtPathValue`. If the mirror is still live, normal writeback already committed counts into the live tree; if it was revoked by a later overwrite/delete, the captured value enters through the resolved-path boundary and is ref-indexed there if needed. If it sees an Error, it calls the local error resolver; if it sees more issue-time promises, it returns that nested `Promise.all`. When the whole promise tree drains, the clean side resolves false.
    - Accepted corner: a later-issued overwrite/delete of a pending key decrements live counts synchronously but wakes nothing until the revoked promise settles — the answer is delayed, not wrong (that promise was in the wait-set as of hasError's issue position, exactly what sequential execution waits for); a never-settling revoked promise leaves hasError pending.

    A reached frozen branch is validated with `validateCountable` instead of probed and treated as settled `[0,0]`; a validation Error returns `true`.

8. **Implemented: fatal error reporting.** Internal/runtime failures go through the global fatal boundary: `reportFatalError(error)` reports and throws. Fatal errors are never language Error values and must never be confused with rejected data promises, which continue to be converted by `onValueResolve` into language Error values at promise-settlement boundaries.

    Required shape:

    - `src/error.js` exports `reportFatalError(error)` and `setFatalErrorReporter(reporter)`; the sandbox reporter is a no-op, and `reportFatalError` always throws the original error after reporting.
    - An object-like fatal value is reported once per identity even when it unwinds through nested wrapper layers; every `reportFatalError` call still throws the original value.
    - Internal invariant failures, compiler-contract violations, continuation throws, and late failures in hasError/normalize wait branches call `reportFatalError`.
    - `onValueResolve` still has exactly one data-facing catch: promise rejection becomes the language Error value before the continuation runs. Exceptions thrown by the continuation, failures while converting a rejection reason, and promises rejected by the continuation are fatal and routed through `reportFatalError`.
    - `onInternalResolve` is for runtime aggregate promises such as hasError's clean wait tree: source rejection or a promise rejected by its continuation is fatal, not converted to a language Error. Races that may answer before all internal waits finish attach this fatal handler to the losing waits, so a later kernel bug is reported even after the public operation result has already settled.
    - A fatal in a discarded internal mutator continuation is reported and leaves its derived promise rejected. Mutators deliberately return nothing, so that rejection reaches the host as unhandled; this is the fatal contract, not a language Error conversion.

9. **Implemented: Chain root state location.** Cascada roots are mutable locations, not bare values. A pending root promise therefore still needs a stable parent/key where normal promise mirrors can live. The sandbox now exports `Chain`; public operators receive a `Chain`, immediately operate on the private `chain._state.value` holder slot, and never walk or ref-index the `Chain` object itself.

    Implemented shape:

    - Public operators receive the `Chain` and operate on `chain._state.value` as the root value.
    - Mutating operators return nothing. They synchronously replace `chain._state.value` when the root is available; when it is a pending promise, the ordinary promise mirror for `_state.value` serializes root-level operations and writes the settled/current value back only while that mirror remains live. Values are observed only through lookupPath, normalize, or hasError; the Chain slot remains the authoritative root location.
    - Bookkeeping functions (`buildRefIndex`, `markShared`, `markImported`, promise mirrors, COW, normalize/hasError branch probes) receive only values below `_state.value`, never `chain`; the private `_state` holder can carry normal META, but it is host state, not language data.
    - Other `Chain` fields such as command arrays, caches, schedulers, and bookkeeping are outside the language object graph. They are not counted, copied, marked, mirrored, or validated by this kernel.

    This keeps the root promise ordering problem solved without turning host runtime objects into Cascada data. A call shaped like `assignPath(chain._state.value, path, value)` is invalid for mutable roots because it cannot update the root location; the valid call shape is `assignPath(chain, path, value)`.

10. **Language integration.** The language layer must route external values and ownership-sensitive operations through the kernel entry points that establish Cascada's invariants.

    **Import.** Every incoming external value must pass through `import(value, errorContext)` before that value can become part of language-owned data. The language layer constructs the error/attribution context (line, file, ...; a string in this sandbox) at the call site. This includes frozen/sealed external structures, external promises used inside language initializers, and extraction of branches from external results (`var x = getExternalValue().a` marks the extracted branch with the same context).

    Example lowering:

    ```js
    // Cascada source
    x = { a: getExternalPromise() }

    // Runtime shape
    x = { a: import(getExternalPromise(), "script.casc:12") }
    ```

    Once roots are routed through `import`, marker propagation is the kernel's job: `lookupPath` marks every escaping value from an imported region (including `sharedOwnership=false`), COW stamps reused children, and flavored mirrors mark settled values — the layer's whole duty is wrapping the boundary crossings and constructing contexts.

    **Compiler single-owner rule.** The kernel cannot detect a raw unimported/unshared tracked value assigned to two locations. The compiler must guarantee it never emits that: escaping or RHS object values go through shared-ownership `lookupPath`. For `a.prop = a`, the RHS is evaluated first through that shared-ownership path, so `a.prop` receives a COW copy of `a` as it existed before `prop` was added. A raw kernel call like `assignPath(root, ["self"], root)` bypasses that lowering and is not valid compiler output.

    Issue 4 also created a class of fatal, compiler-facing throws that this layer must own — they are JS exceptions, never language Error values:

    - `import` without an errorContext throws (a missing context would silently disable provenance).
    - `assignPath`/`deletePath` throw on a `__proto__` path segment and on mutations through own non-enumerable properties.
    - Statically emitted segments can be guaranteed clean at compile time, but computed segments (`x[key] = v`) can carry any user string, including `"__proto__"` — the language layer must screen dynamic segments before issuing the operation (or catch at the operation boundary and convert to its own error value). User data must not be able to crash the runtime through a key name.

    After this step, the kernel can trust language-created object literals, assignments, COW copies, and path walks to contain only already-marked values, and every lazy validation failure can name the import that caused it.

11. **Class-instance copy-on-write adapters.** Imported class instances are valid containers for Cascada-visible own enumerable data, but copying every non-array object into `{}` silently discards class identity and methods. Generic prototype preservation is not sound: `Object.create(Object.getPrototypeOf(value))` cannot reproduce private fields or native internal slots, and can therefore create an object that passes `instanceof` while its methods fail.

    Add an explicit host-only shallow-copy protocol, exposed as a Symbol that is outside the language-visible string-key graph. A participating class implements the protocol and returns a fresh, extensible instance with its private/non-enumerable/internal state copied and exactly the same own enumerable string keys and values as the source. The kernel validates that contract, then keeps ownership of its existing per-key work: shared/import marker propagation, promise-mirror forks, counter copying, and parent-edge registration. Plain objects, null-prototype records, and arrays retain their built-in copy paths; `normalize(..., plainCopy=true)` remains deliberately plain-data output.

    An unadapted non-plain object may still be observed and ref-indexed through its own enumerable data, but an operation that requires COW through it must produce an attributed language Error rather than silently demoting it to a plain object. A throwing adapter or one that returns the source, a non-extensible/untracked value, or a different enumerable key/value surface is a fatal host-contract violation and must leave no partial mirrors, counters, or writes.

    Tests must cover a nested imported class instance plus ordinary sibling and top-level properties; mutation must leave the external instance and siblings unchanged, preserve `instanceof`, and keep a method using private state functional. Also cover promise/Error fields through the adapted instance, shared aliases, an unadapted class, and malformed adapters under both metadata storage modes.
