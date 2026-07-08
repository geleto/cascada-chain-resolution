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
    - Import screening forbids non-extensible frozen/sealed subtrees from containing promises or Error values anywhere beneath them in the language-visible enumerable string-key graph. A frozen subtree is permanently `[0,0]` and carries no counter metadata.
    - Counter metadata, promise mirrors, and the SHARED mark share the single `META` record in `src/meta.js`.
    - `normalize`/`hasError` are still covered by issue 5; they will activate this ref-indexing at their public operation boundary.

2. **Implemented: single META record and accessors.** `src/meta.js` owns the one logical metadata record. Storage is selected by `STORE_META_IN_WEAKMAP`: inline non-enumerable Symbol property by default, or WeakMap. Shared marks, promise mirrors, and subtree counters all use that record, and `shallowCopy` never copies it as language data.

    ```js
    function createMeta() {
        return {
            shared: false,   // set once, never cleared; false at birth = "no mark"
            mirrors: null,   // lazy Object.create(null), the promise mirror map
            promiseCount: 0,
            errorCount: 0,
            settlementVerifyScheduled: false,
            // parents is added by refIndexBranch when counters become live:
            // undefined => not ref-indexed; empty Map => ref-indexed root / no ref-indexed parents.
            // settlementWatchers is added only by normalize while callers wait.
        }
    }
    ```

    Implemented rules:

    - `metaOf(value)` returns metadata only for extensible tracked nodes; frozen/sealed nodes carry no record.
    - `hasSharedMark(value)` reads `metaOf(value)?.shared === true || !Object.isExtensible(value)`.
    - Promise mirrors live in `meta.mirrors`, created lazily as `Object.create(null)`.
    - Counter fields live directly on META. `parents === undefined` remains the ref-indexing gate; record existence alone does not mean counters are live.
    - COW copies receive no copied META object. If counters are live, `copyCounters` creates a fresh META record and snapshots counts there.

3. **Implemented: ref-indexing and import boundary screening walkers.** Ref-indexing scans trusted language-owned structures that become part of a ref-indexed region: initialize counters bottom-up, register parent edges, and mint a promise mirror for every promise-valued key. Mirror minting is eager because ref-indexed regions are not rescanned; an orphan promise with no writeback would otherwise hold `promiseCount` up forever.

    Boundary validation is an import concern. Language-created data is trusted; path walks, COW forks, and ref-indexing do not perform broad validation. Imported data is validated before any runtime metadata is attached, so a validation failure cannot leave live DAG-shared nodes with parent edges or mirrors into rejected data.

    Entry points:

    - `screenImportBoundary(value, target?)`: import validates, mints mirrors, and registers mark-on-settle continuations, but builds no counters/parents. Promise values reached by import are screened recursively when they settle. When a screened writeback has a target, validation also rejects values that can reach that target, preventing externally-created back-edge cycles.
    - `refIndexBranch(value)`: first `normalize`/`hasError` on a branch, writes into ref-indexed parents, and ref-indexed writeback commits. It assumes valid language-owned data and performs the counter/mirror/edge commit.

    Import screening rejects cycles, screened writeback back-edges, frozen/sealed subtrees containing promises or Error values, and own `__proto__` keys across the language-visible enumerable string-key graph. A frozen imported object with a promise/Error key is invalid boundary data and returns an Error instead of throwing while trying to attach mirror metadata. Imported promise-valued keys use screened writebacks, so their settled values are validated before being written. Reusing an existing import mirror avoids duplicate import-mode continuations.

    Traversal uses two-color marking: reaching a visiting node is a cycle; reaching a visited node is a DAG share and reuses its validation result or totals.

4. **Counter bookkeeping in write helpers.** Runtime property writes/deletes live in `src/index.js`; `src/refcounts.js` exposes `refSetProperty(parent, key, value)` and `refDeleteProperty(parent, key)` for counter-only bookkeeping. The module layers without circular imports: `src/helpers.js` -> `src/validate.js`/`src/meta.js` -> `src/refcounts.js` -> `src/index.js`; mirror minting needed during ref-indexing is injected once with `refcounts.initRef({ mintPromiseMirror })`. Discovering a promise before this hook is installed is a fatal runtime configuration error.

    The refcount helpers never perform the language write/delete. If the written parent is not ref-indexed (`metaOf(parent)?.parents === undefined`), they no-op and return the original value. The gate is checked when the helper runs, so continuations registered before ref-indexing bookkeep correctly after ref-indexing.

    - `refSetProperty(parent, key, value)`: ref-index an entering value when needed, compute `-getRefCounts(old) + getRefCounts(new)`, swap parent edges, propagate, and return the value that `src/index.js` should write.
    - `refDeleteProperty(parent, key)`: compute `-getRefCounts(old)`, remove the parent edge, and propagate before `src/index.js` deletes the key.
    - If a child's `Map<parent, edgeCount>` reaches zero for that parent, delete only that map entry; never delete the `parents` map itself.
    - Promise mirror lifecycle remains at operation sites: fresh mirror on promise assignment, guarded writeback, clear on overwrite/delete.
    - `shallowCopy` copies language keys, forks mirrors, then calls `copyCounters(source, copy)`. Ref-indexed copies snapshot counts, receive `parents = new Map()`, and register themselves as parent on reused tracked children.

5. **Settlement, `normalize`, and `hasError`.** Both ops ref-index the reached branch on first use at the caller's program position. Ref-indexing trusts language-owned data; import boundary screening is responsible for cycles, frozen-rule violations, `__proto__`, and external writeback back-edges before data enters the trusted graph. Both resume through the uniform wrapper in FIFO order and never schedule outside the wrapper.

    `normalize(root, segments, full=false)` resolves the path, then marks the reached branch shared at call time. That mark pins the snapshot: later-issued operations COW away from it, while suspended remainders of earlier-issued operations still land through in-place mirror advances. Therefore `promiseCount === 0` is the exact wait-set: promises present at the call plus promises recursively exposed by their resolved values. Do not collapse to Error until settlement, because an earlier-issued remainder may still replace an Error before zero.

    Normalize waiter mechanics:

    - `meta.settlementWatchers` exists only while normalize callers are waiting.
    - `meta.settlementVerifyScheduled` coalesces queued verification.
    - Verification is enqueued only while waiters exist, both on zero-crossing and subscribe-at-zero.
    - It never fires synchronously and never uses a bare microtask; register it through `onResolve` on the settling promise.
    - On run, re-check and fire only if `promiseCount` is still zero; otherwise stay armed.

    At settlement: `errorCount > 0` returns a single Error; `full=true` returns a deep copy through an old->new identity map consulted before recursing; otherwise return the already-marked branch.

    `hasError(root, segments)` is a pure query and never marks. Resolve the parent path; broken intermediate paths are true, missing terminal properties are false. At the reached branch, return true immediately if `errorCount > 0`, return false immediately if `promiseCount === 0`, otherwise follow only pending promises by descending nodes with `promiseCount > 0` and probe again at each settlement. First error wins; zero pending means false. Frozen roots/branches are treated as already-settled `[0,0]`.

    Early-exit ref-indexing for `hasError` requires an atomic-per-node commit rule: a node's counters and child parent edges are established together only after every child is processed. A bailed walk must leave every node either fully counted or uncounted, never partial, with no child edge pointing at an uncounted parent. `verifyRefCounts` must pass after an early-exit probe.

6. **Frames as nodes.** Treat scope frames as nodes with variables as keys, so a pending root is an ordinary promise-valued edge and the mirror machinery applies with paths like `["varName", ...segments]`. This removes the language-level need for per-op derived-promise chains on pending roots.

7. **Compiler single-owner rule.** The kernel cannot detect a raw unimported/unshared promise assigned to two locations. The compiler must guarantee it never emits that; external values enter through `import`, and escaping or RHS object values go through shared-ownership `lookupPath`. This is what prevents synchronous self-reference writes from creating cycles; raw `assignPath(root, ["self"], root)` is not a valid compiler lowering.

8. **Language integration.** The language layer must screen every incoming external value through `import` before that value can become part of language-owned data. This includes frozen/sealed external structures and external promises used inside language initializers. Import must happen before any path operation or ref-indexing walk can discover that external value's promise keys.

    Example lowering:

    ```js
    // Cascada source
    x = { a: getExternalPromise() }

    // Runtime shape
    x = { a: import(getExternalPromise()) }
    ```

    After this step, the kernel can trust language-created object literals, assignments, COW copies, and path walks to contain only already-screened values.
