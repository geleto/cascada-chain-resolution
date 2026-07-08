# Issues

## Subtree Counters

1. **Implemented: subtree counters replace the CLEAN flag.** `refcounts.js` now owns exact `promiseCount`/`errorCount` totals for ref-indexed branches. Ref-indexing is lazy and per branch; never-checked data pays zero counter bookkeeping. Existing writes/deletes go through counter-aware helpers, ref-indexed writes evaluate the bookkeeping gate at commit time, promise writebacks replace `[1,0]` with the resolved value's counts, and COW copies snapshot counters for the copied world.

    Implemented rules:

    - Ref-indexed regions are downward-closed: ref-indexing walks whole subtrees, and writes into ref-indexed parents ref-index the entering value before commit.
    - The ref-indexed gate is evaluated at commit time, never captured at registration time.
    - `parents === undefined` means not ref-indexed; an empty `Map` means ref-indexed root / no ref-indexed parents.
    - CLEAN is only derived: clean means `promiseCount === 0 && errorCount === 0`.
    - Ownership/COW stays mark-based; counters answer "what is pending/broken below me", and the SHARED mark answers "who else can see me".
    - Error values count as language errors inside ref-indexed branches.
    - Non-extensible frozen/sealed ref-indexed subtrees are forbidden to contain promises or Error values anywhere beneath them. A frozen subtree is permanently `[0,0]` and carries no counter metadata.
    - Counter metadata is isolated in `refcounts.js` under its own non-enumerable Symbol for now. Issue 2 will fold counters, promise mirrors, and the SHARED mark into one `META` record.
    - `normalize`/`hasError` are still covered by issue 5; they will activate this ref-indexing at their public operation boundary.

2. **Single META record and accessors.** Consolidate `PROMISE_MIRRORS`, `SHARED`, and the counters into one non-enumerable Symbol record that is never copied by `shallowCopy`.

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

    `hasSharedMark(value)` reads `metaOf(value)?.shared === true || !Object.isExtensible(value)`. `canUpdateMirrorToLive(node, key, mirror)` reads `meta.mirrors?.[key]`; no record means the guard fails. `getRefCounts(value)` returns `[1,0]` for pending or settled-but-unreplaced promises, `[0,1]` for Error values, `[0,0]` for non-extensible nodes and primitives, and stored totals for ref-indexed tracked nodes, ref-indexing first if needed. If that defensive ref-indexing finds invalid owned data, it throws as a fatal kernel invariant failure; write helpers convert entering-value failures to Error values before calling it. `applyCountDelta(node, dPromise, dError)` updates the node and recurses through every parent edge with multiplicity; zero deltas short-circuit and settlement waiters are scheduled on zero-crossing.

3. **Ref-indexing and boundary screening walkers.** Ref-indexing scans structures that become part of a ref-indexed region: initialize counters bottom-up, register parent edges, and mint a promise mirror for every promise-valued key. Mirror minting is eager because ref-indexed regions are not rescanned; an orphan promise with no writeback would otherwise hold `promiseCount` up forever.

    Validation and commit are separate passes. The validate pass is pure: two-color cycle check, frozen rule, and direct writeback back-edge reachability. The commit pass creates metadata, counters, mirrors, and edges and cannot fail. This avoids leaving live DAG-shared nodes with parent edges into rejected data after a late validation failure.

    Entry points:

    - `screenExternalValue(target, value)`: every external writeback validates frozen/cycle rules before data enters; for ref-indexed targets it also performs the ref-indexing commit.
    - `scanImportBoundary(value)`: import validates, mints mirrors, and registers mark-on-settle continuations, but builds no counters/parents.
    - `refIndexBranch(value)`: first `normalize`/`hasError` on a branch, writes into ref-indexed parents, and ref-indexed writeback commits. Write commits run the direct back-edge check before calling it.

    The back-edge check descends the value and rejects if it reaches the write target. Traversal uses two-color marking: reaching a visiting node is a cycle; reaching a visited node is a DAG share and reuses its totals.

4. **Counter bookkeeping in write helpers.** Runtime property writes/deletes live in `index.js`; `refcounts.js` exposes `refSetProperty(parent, key, value)` and `refDeleteProperty(parent, key)` for counter-only bookkeeping. The module layers without circular imports: `helpers.js` -> `validate.js`/`meta.js` -> `refcounts.js` -> `index.js`; mirror minting needed during ref-indexing is injected once with `refcounts.initRef({ mintPromiseMirror })`. Discovering a promise before this hook is installed is a fatal runtime configuration error.

    The refcount helpers never perform the language write/delete. If the written parent is not ref-indexed (`metaOf(parent)?.parents === undefined`), they no-op and return the original value. The gate is checked when the helper runs, so continuations registered before ref-indexing bookkeep correctly after ref-indexing.

    - `refSetProperty(parent, key, value)`: ref-index an entering value when needed, compute `-getRefCounts(old) + getRefCounts(new)`, swap parent edges, propagate, and return the value that `index.js` should write.
    - `refDeleteProperty(parent, key)`: compute `-getRefCounts(old)`, remove the parent edge, and propagate before `index.js` deletes the key.
    - If a child's `Map<parent, edgeCount>` reaches zero for that parent, delete only that map entry; never delete the `parents` map itself.
    - Promise mirror lifecycle remains at operation sites: fresh mirror on promise assignment, guarded writeback, clear on overwrite/delete.
    - `shallowCopy` copies language keys, forks mirrors, then calls `copyCounters(source, copy)`. Ref-indexed copies snapshot counts, receive `parents = new Map()`, and register themselves as parent on reused tracked children.

5. **Settlement, `normalize`, and `hasError`.** Both ops ref-index the reached branch on first use at the caller's program position and surface ref-indexing violations as language values (`normalize` returns Error; `hasError` returns true). Both resume through the uniform wrapper in FIFO order and never schedule outside the wrapper.

    `normalize(root, segments, full=false)` resolves the path, then marks the reached branch shared at call time. That mark pins the snapshot: later-issued operations COW away from it, while suspended remainders of earlier-issued operations still land through in-place mirror advances. Therefore `promiseCount === 0` is the exact wait-set: promises present at the call plus promises recursively exposed by their resolved values. Do not collapse to Error until settlement, because an earlier-issued remainder may still replace an Error before zero.

    Normalize waiter mechanics:

    - `meta.settlementWatchers` exists only while normalize callers are waiting.
    - `meta.settlementVerifyScheduled` coalesces queued verification.
    - Verification is enqueued only while waiters exist, both on zero-crossing and subscribe-at-zero.
    - It never fires synchronously and never uses a bare microtask; register it through `onResolve` on the settling promise.
    - On run, re-check and fire only if `promiseCount` is still zero; otherwise stay armed.

    At settlement: `errorCount > 0` returns a single Error; `full=true` returns a deep copy through an old->new identity map consulted before recursing; otherwise return the already-marked branch.

    `hasError(root, segments)` is a pure query and never marks. Resolve the parent path; broken intermediate paths are true, missing terminal properties are false. At the reached branch, return true immediately if `errorCount > 0`, return false immediately if `promiseCount === 0`, otherwise follow only pending promises by descending nodes with `promiseCount > 0` and probe again at each settlement. First error wins; zero pending means false. Frozen roots/branches are validated and treated as settled `[0,0]`.

    Early-exit ref-indexing for `hasError` requires an atomic-per-node commit rule: a node's counters and child parent edges are established together only after every child is processed. A bailed walk must leave every node either fully counted or uncounted, never partial, with no child edge pointing at an uncounted parent. `verifyRefCounts` must pass after an early-exit probe.

6. **Frames as nodes.** Treat scope frames as nodes with variables as keys, so a pending root is an ordinary promise-valued edge and the mirror machinery applies with paths like `["varName", ...segments]`. This removes the language-level need for per-op derived-promise chains on pending roots.

7. **Compiler single-owner rule.** The kernel cannot detect a raw unimported/unshared promise assigned to two locations. The compiler must guarantee it never emits that; external values enter through `import`, and escaping values go through shared-ownership `lookupPath`.
