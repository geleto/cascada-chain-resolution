# Issues

## Subtree Counters

1. **Subtree counters replace the CLEAN flag.** Every indexed node carries exact `pendingCount`/`errorCount` totals for its subtree, so `hasError` is O(1)-guided and `normalize` completes from a counter event instead of rescanning. Indexing is lazy and per branch: the first `normalize`/`hasError` on a branch indexes that branch, stopping at already-indexed sub-branches and registering the boundary edge; from then on the indexed region is maintained. Never-checked data pays zero counter bookkeeping; first check pays the one O(branch) scan; repeated checks use the counters.

    Required rules:

    - Indexed regions are downward-closed: indexing walks whole subtrees, and writes into indexed parents index entering values.
    - The indexed gate is evaluated at commit time, never captured at registration time.
    - `parents === undefined` means unindexed; an empty `Map` means indexed root / no indexed parents.
    - CLEAN is only derived: clean means `pendingCount === 0 && errorCount === 0`.
    - Ownership/COW stays mark-based; counters answer "what is pending/broken below me", and the SHARED mark answers "who else can see me".
    - Imported Error values count as language errors.
    - Non-extensible frozen/sealed nodes are forbidden to contain promises or Error values anywhere beneath them. A frozen subtree is permanently `(0,0)` and carries no metadata: no counters, no parents, no mirrors.
    - Runtime metadata remains inline: one non-enumerable `META` Symbol record per extensible node.

2. **Single META record and accessors.** Consolidate `PROMISE_MIRRORS`, `SHARED`, and the counters into one non-enumerable Symbol record that is never copied by `shallowCopy`.

    ```js
    function createMeta() {
        return {
            shared: false,   // set once, never cleared; false at birth = "no mark"
            mirrors: null,   // lazy Object.create(null), the promise mirror map
            pendingCount: 0,
            errorCount: 0,
            settlementVerifyScheduled: false,
            // parents is added by indexBranch when counters become live:
            // undefined => not indexed; empty Map => indexed root / no indexed parents.
            // settlementWatchers is added only by normalize while callers wait.
        }
    }
    ```

    `hasSharedMark(value)` reads `metaOf(value)?.shared === true || !Object.isExtensible(value)`. `canUpdateMirrorToLive(node, key, mirror)` reads `meta.mirrors?.[key]`; no record means the guard fails. `countsOf(value)` returns `(1,0)` for pending or settled-but-unreplaced promises, `(0,1)` for Error values, `(0,0)` for non-extensible nodes and primitives, and stored totals for indexed tracked nodes, indexing first if needed. `applyCountDelta(node, dPending, dError)` updates the node and recurses through every parent edge with multiplicity; zero deltas short-circuit and settlement waiters are scheduled on zero-crossing.

3. **Indexing and boundary screening walkers.** Counter indexing scans structures that become part of an indexed region: initialize counters bottom-up, register parent edges, and mint a promise mirror for every promise-valued key. Mirror minting is eager because indexed regions are not rescanned; an orphan promise with no writeback would otherwise hold `pendingCount` up forever.

    Validation and commit are separate passes. The validate pass is pure: two-color cycle check, frozen rule, and direct writeback back-edge reachability. The commit pass creates metadata, counters, mirrors, and edges and cannot fail. This avoids leaving live DAG-shared nodes with parent edges into rejected data after a late validation failure.

    Entry points:

    - `screenExternalValue(target, value)`: every external writeback validates frozen/cycle rules before data enters; for indexed targets it also performs the indexing commit.
    - `scanImportBoundary(value)`: import validates, mints mirrors, and registers mark-on-settle continuations, but builds no counters/parents.
    - `indexBranch(value, backEdgeTarget = null)`: first `normalize`/`hasError` on a branch, writes into indexed parents, and indexed writeback commits.

    The back-edge check descends the value and rejects if it reaches the write target. Traversal uses two-color marking: reaching a visiting node is a cycle; reaching a visited node is a DAG share and reuses its totals.

4. **Counter bookkeeping in write helpers.** All runtime property writes/deletes go through `setProperty(parent, key, value)` and `deleteProperty(parent, key)` in `refcounts.js`. The module layers without circular imports: `helpers.js` -> `meta.js` -> `refcounts.js` -> `index.js`; mirror minting needed during indexing is injected once with `refcounts.init({ mintMirror })`.

    The helpers own only counter bookkeeping. If the written parent is unindexed (`metaOf(parent)?.parents === undefined`), they perform the bare write/delete and skip bookkeeping. The gate is checked when the helper runs, so continuations registered before indexing bookkeep correctly after indexing.

    - `setProperty(parent, key, value)`: index an entering value when needed, compute `-countsOf(old) + countsOf(new)`, swap parent edges, write, propagate.
    - `deleteProperty(parent, key)`: compute `-countsOf(old)`, remove the parent edge, delete, propagate.
    - If a child's `Map<parent, edgeCount>` reaches zero for that parent, delete only that map entry; never delete the `parents` map itself.
    - Promise mirror lifecycle remains at operation sites: fresh mirror on promise assignment, guarded writeback, clear on overwrite/delete.
    - `shallowCopy` copies language keys, forks mirrors, then calls `copyCounters(source, copy)`. Indexed copies snapshot counts, receive `parents = new Map()`, and register themselves as parent on reused tracked children.

5. **Settlement, `normalize`, and `hasError`.** Both ops index the reached branch on first use at the caller's program position and surface indexing violations as language values (`normalize` returns Error; `hasError` returns true). Both resume through the uniform wrapper in FIFO order and never schedule outside the wrapper.

    `normalize(root, segments, full=false)` resolves the path, then marks the reached branch shared at call time. That mark pins the snapshot: later-issued operations COW away from it, while suspended remainders of earlier-issued operations still land through in-place mirror advances. Therefore `pendingCount === 0` is the exact wait-set: promises present at the call plus promises recursively exposed by their resolved values. Do not collapse to Error until settlement, because an earlier-issued remainder may still replace an Error before zero.

    Normalize waiter mechanics:

    - `meta.settlementWatchers` exists only while normalize callers are waiting.
    - `meta.settlementVerifyScheduled` coalesces queued verification.
    - Verification is enqueued only while waiters exist, both on zero-crossing and subscribe-at-zero.
    - It never fires synchronously and never uses a bare microtask; register it through `onResolve` on the settling promise.
    - On run, re-check and fire only if `pendingCount` is still zero; otherwise stay armed.

    At settlement: `errorCount > 0` returns a single Error; `full=true` returns a deep copy through an old->new identity map consulted before recursing; otherwise return the already-marked branch.

    `hasError(root, segments)` is a pure query and never marks. Resolve the parent path; broken intermediate paths are true, missing terminal properties are false. At the reached branch, return true immediately if `errorCount > 0`, return false immediately if `pendingCount === 0`, otherwise follow only pending promises by descending nodes with `pendingCount > 0` and probe again at each settlement. First error wins; zero pending means false. Frozen roots/branches are validated and treated as settled `(0,0)`.

    Early-exit indexing for `hasError` requires an atomic-per-node commit rule: a node's counters and child parent edges are established together only after every child is processed. A bailed walk must leave every node either fully counted or uncounted, never partial, with no child edge pointing at an uncounted parent. `verifyRefCounts` must pass after an early-exit probe.

6. **Frames as nodes.** Treat scope frames as nodes with variables as keys, so a pending root is an ordinary promise-valued edge and the mirror machinery applies with paths like `["varName", ...segments]`. This removes the language-level need for per-op derived-promise chains on pending roots.

7. **Compiler single-owner rule.** The kernel cannot detect a raw unimported/unshared promise assigned to two locations. The compiler must guarantee it never emits that; external values enter through `import`, and escaping values go through shared-ownership `lookupPath`.
