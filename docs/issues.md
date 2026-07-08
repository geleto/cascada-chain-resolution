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
    - `normalize`/`hasError` are still covered by issue 6; they will activate this ref-indexing at their public operation boundary.

2. **Implemented: single META record and accessors.** `src/meta.js` owns the one logical metadata record. Storage is selected by `STORE_META_IN_WEAKMAP`: inline non-enumerable Symbol property by default, or WeakMap. Shared marks, promise mirrors, and subtree counters all use that record, and `shallowCopy` never copies it as language data.

    ```js
    function createMeta() {
        return {
            shared: false,   // set once, never cleared; false at birth = "no mark"
            mirrors: null,   // lazy Object.create(null), the promise mirror map
            promiseCount: 0,
            errorCount: 0,
            settlementVerifyScheduled: false,
            importContext: undefined,   // issue 4: undefined = not imported; string = attribution
            // parents is added by refIndexBranch when counters become live:
            // undefined => not ref-indexed; empty Map => ref-indexed root / no ref-indexed parents.
            // settlementWatchers is added only by normalize while callers wait.
        }
    }
    ```

    Implemented rules:

    - `metaOf(value)` returns metadata for tracked nodes in WeakMap mode, including frozen/sealed nodes; inline Symbol mode returns metadata only for extensible tracked nodes.
    - `hasSharedMark(value)` reads `metaOf(value)?.shared === true || !Object.isExtensible(value)`.
    - Promise mirrors live in `meta.mirrors`; `src/promise-mirrors.js` creates the map lazily as `Object.create(null)` and owns mirror lifecycle.
    - Counter fields live directly on META. `parents === undefined` remains the ref-indexing gate; record existence alone does not mean counters are live.
    - COW copies receive no copied META object. If counters are live, `copyCounters` creates a fresh META record and snapshots counts there.

3. **Implemented, superseded by issue 4: eager import boundary screening.** `screenImportBoundary(value, target?)` validated cycles, frozen-rule violations, own `__proto__` keys, and screened-writeback back-edges eagerly at the boundary, minted screened mirrors for every imported promise key, and re-screened resolved values at settlement. Issue 4 removes this machinery: import becomes a mark-only O(1) operation and validation moves to counting time. The parts that survive unchanged: ref-indexing walks whole subtrees, initializes counters bottom-up, registers parent edges, and mints a promise mirror for every promise-valued key (eager minting because ref-indexed regions are never rescanned; an orphan promise with no writeback would hold `promiseCount` up forever); traversal uses two-color marking (reaching a visiting node is a cycle; reaching a visited node is a DAG share and reuses its result).

4. **Implemented: lazy import marking and counting-time validation.** Full design: `docs/lazy-import.md`. `import(value, errorContext)` is mark-only: it stores the error/attribution context (a string in this sandbox; line/file/etc. in Cascada) in the META `importContext` field, sets the shared mark, and returns — no walk, no validation, no mirror minting. The errorContext is **required**: importing without one throws (fatal configuration/compiler error — an absent context would silently disable provenance propagation, since `importContext === undefined` is the "not imported" sentinel). Non-extensible imported values keep attribution in META under WeakMap storage, or in a scoped side table under inline Symbol storage, so attribution is durable for every outcome. Untouched imported promises are never resolved in place; external objects the program merely holds are never mutated. Validation collapses to a single pure `validateCountable(value, writeTarget)` used exactly where counting needs its guarantees — `refIndexBranch` (first `normalize`/`hasError`) and ref-indexed write commits (with the write-target back-edge check) — covering cycles, the frozen rule, and back-edges, with failures surfaced by operation semantics and attributed to the import context. An entering value pays exactly two passes (pure validate, infallible commit — the transactionality split); there is no third: `commitRefIndex` returns the committed totals and the write path uses them directly.

    Implemented changes:

    - Remove: `validateImportBoundary`/`validateImportValue`, `screenImportBoundary`, `scanImportedValue`, `getOrCreateImportedPromiseMirror`, `mirror.screenValue`, `IMPORTED_PROMISES`, `forbiddenPathError`/`FORBIDDEN_PATH_KEY`, and their tests.
    - Runtime writes stay plain `node[key] = value`; `__proto__` is forbidden as a language key. Lookup treats `__proto__` and own non-enumerable properties as missing; mutations through `__proto__` throw, owned non-enumerable properties throw, and shared/imported branches COW before the check so non-enumerables are shadowed as missing; counting rejects imported own enumerable `__proto__` keys; COW copy preserves such keys by pre-creating an own data slot before assignment.
    - META `importContext` + `markImported`/`nodeImportContext` (non-extensible imported nodes use META in WeakMap mode, or the side table then inherited context in inline Symbol mode; no generic fallback); mark-only `import`.
    - Marker propagation: lookup extraction (even with `sharedOwnership=false` — provenance is about origin, not aliasing), COW reuse (all tracked children including the path key), and mirror flavor (discovery, forks, and ref-indexing carry the context; writebacks mark settled values imported+shared before consumers observe them).
    - `validateCountable` in `src/validate.js`; wire into `refIndexBranch` (no target; may skip already-ref-indexed subtrees) and `refSetProperty` (target = written parent; no early exit on the descent). Validate-then-commit stays two-pass: a failure must leave no partial counters, edges, or mirrors.
    - Frozen data becomes graceful outside counting: lookup reads through a frozen holder's promise key mirror-free (no advance is possible, the raw settled value is the only version); COW of a frozen source seeds the fork mirror from the raw promise. Only counting rejects frozen-with-promise/Error.

    Deliberately accepted trade-offs: invalid imports fail at first counting use (permanently for that branch) instead of at the import site — the errorContext exists to point back; a back-edge writeback under a non-ref-indexed target commits and the cycle floats harmlessly in the uncounted region (all walks are path-bounded) until counting rejects it. Getter/proxy side effects are out of scope: a developer who mutates or counts exotic objects through Cascada must ensure they behave as plain data.

5. **Implemented: counter bookkeeping in write helpers.** Runtime property writes/deletes live in `src/index.js`; `src/refcounts.js` exposes `refSetProperty(parent, key, value)` and `refDeleteProperty(parent, key)` for counter-only bookkeeping. The module layers without circular imports: `src/helpers.js` -> `src/meta.js` -> `src/validate.js`/`src/promise-mirrors.js` -> `src/refcounts.js` -> `src/index.js` (validate and promise-mirrors both sit on meta; refcounts imports all three; `validateCountable` takes `isRefIndexed` as a parameter so validate stays below refcounts); promise mirror storage/birth lives in `src/promise-mirrors.js`, and `src/index.js` initializes mirror writeback with `initPromiseMirrors(setProperty)`.

    The refcount helpers never perform the language write/delete. If the written parent is not ref-indexed (`metaOf(parent)?.parents === undefined`), they no-op and return the original value. The gate is checked when the helper runs, so continuations registered before ref-indexing bookkeep correctly after ref-indexing.

    - `refSetProperty(parent, key, value)`: validate (issue 4) and ref-index an entering value when needed, subtract `getRefCounts(old)` and add the entering value's totals taken from the commit pass itself (promise `[1,0]`, Error `[0,1]`, tracked value the totals `commitRefIndex` returns, a validation failure an Error counted `[0,1]`), swap parent edges, propagate, and return the value that `src/index.js` should write.
    - `refDeleteProperty(parent, key)`: compute `-getRefCounts(old)`, remove the parent edge, and propagate before `src/index.js` deletes the key.
    - If a child's `Map<parent, edgeCount>` reaches zero for that parent, delete only that map entry; never delete the `parents` map itself.
    - Promise mirror lifecycle remains at operation sites: fresh mirror on promise assignment, guarded writeback, clear on overwrite/delete.
    - `shallowCopy` copies language keys, forks mirrors, then calls `copyCounters(source, copy)`. Ref-indexed copies snapshot counts, receive `parents = new Map()`, and register themselves as parent on reused tracked children.

6. **Settlement, `normalize`, and `hasError`.** Both ops ref-index the reached branch on first use at the caller's program position and surface counting-validation failures as language values with import-context attribution (`normalize` returns Error; `hasError` returns true). Both resume through the uniform wrapper in FIFO order and never schedule outside the wrapper.

    `normalize(root, segments, full=false)` resolves the path, then marks the reached branch shared at call time. That mark pins the snapshot: later-issued operations COW away from it, while suspended remainders of earlier-issued operations still land through in-place mirror advances. Therefore `promiseCount === 0` is the exact wait-set: promises present at the call plus promises recursively exposed by their resolved values. Do not collapse to Error until settlement, because an earlier-issued remainder may still replace an Error before zero.

    Normalize waiter mechanics:

    - `meta.settlementWatchers` exists only while normalize callers are waiting.
    - `meta.settlementVerifyScheduled` coalesces queued verification.
    - Verification is enqueued only while waiters exist, both on zero-crossing and subscribe-at-zero.
    - It never fires synchronously and never uses a bare microtask; register it through `onResolve` on the settling promise.
    - On run, re-check and fire only if `promiseCount` is still zero; otherwise stay armed.

    At settlement: `errorCount > 0` returns a single Error; `full=true` returns a deep copy through an old->new identity map consulted before recursing (preserving own enumerable `__proto__` data keys before plain assignment); otherwise return the already-marked branch.

    `hasError(root, segments)` is a pure query and never marks. Resolve the parent path; broken intermediate paths are true, missing terminal properties are false. `normalize` and `hasError` are read-shaped, so `__proto__` and own non-enumerable segments follow lookup semantics (issue 4) — they read as missing, never throw: false at a terminal position, broken-path true when intermediate. At the reached branch, return true immediately if `errorCount > 0`, return false immediately if `promiseCount === 0`, otherwise follow only pending promises by descending nodes with `promiseCount > 0` and probe again at each settlement. First error wins; zero pending means false. Frozen roots/branches are validated with `validateCountable` and treated as settled `[0,0]`.

    Early-exit ref-indexing for `hasError` requires an atomic-per-node commit rule: a node's counters and child parent edges are established together only after every child is processed. A bailed walk must leave every node either fully counted or uncounted, never partial, with no child edge pointing at an uncounted parent. Under issue 4 this extends to validation: **the validate prefix and the commit prefix must cover the same nodes** — the region beyond the bail point stays unvalidated precisely because it also stays uncommitted (no parent edges reach into it). The concrete contract: process children in key order, and per child validate its whole subtree, then commit it, then move to the next sibling; a bail (error found, or validation failure surfaced as true) leaves earlier siblings as fully validated-and-committed islands — the same legal state an early exit produces. Skipping already-ref-indexed subtrees during a sibling's validation stays sound by downward closure: indexed nodes cannot reach unindexed ones, so no cycle can thread from an uncommitted sibling through a committed one and back. `verifyRefCounts` must pass after an early-exit probe.

7. **Language integration.** The language layer must route external values and ownership-sensitive operations through the kernel entry points that establish Cascada's invariants.

    **Import boundary.** Every incoming external value must pass through `import(value, errorContext)` before that value can become part of language-owned data. The language layer constructs the error/attribution context (line, file, ...; a string in this sandbox) at the call site. This includes frozen/sealed external structures, external promises used inside language initializers, and extraction of branches from external results (`var x = getExternalValue().a` marks the extracted branch with the same context).

    Example lowering:

    ```js
    // Cascada source
    x = { a: getExternalPromise() }

    // Runtime shape
    x = { a: import(getExternalPromise(), "script.casc:12") }
    ```

    Once roots are routed through `import`, marker propagation is the kernel's job: `lookupPath` marks every escaping value from an imported region (including `sharedOwnership=false`), COW stamps reused children, and flavored mirrors mark settled values — the layer's whole duty is wrapping the boundary crossings and constructing contexts.

    **Ownership lowering.** The kernel cannot detect a raw unimported/unshared tracked value assigned to two locations. The compiler must guarantee it never emits that: escaping or RHS object values go through shared-ownership `lookupPath`. For `a.prop = a`, the RHS is evaluated first through that shared-ownership path, so `a.prop` receives a COW copy of `a` as it existed before `prop` was added. A raw kernel call like `assignPath(root, ["self"], root)` bypasses that lowering and is not valid compiler output.

    Issue 4 also created a class of fatal, compiler-facing throws that this layer must own — they are JS exceptions, never language Error values:

    - `import` without an errorContext throws (a missing context would silently disable provenance).
    - `assignPath`/`deletePath` throw on a `__proto__` path segment and on mutations through own non-enumerable properties.
    - Statically emitted segments can be guaranteed clean at compile time, but computed segments (`x[key] = v`) can carry any user string, including `"__proto__"` — the language layer must screen dynamic segments before issuing the operation (or catch at the operation boundary and convert to its own error value). User data must not be able to crash the runtime through a key name.

    After this step, the kernel can trust language-created object literals, assignments, COW copies, and path walks to contain only already-marked values, and every lazy validation failure can name the import that caused it.
