# Issues

## Basics — do first

1. **[bug] Importing a frozen/sealed object throws.** `markImmutable` uses `defineProperty` (index.js:60), which throws `TypeError: object is not extensible` on frozen input — and external data is exactly where frozen objects appear. When the frozen value arrives as a promise resolution, the throw happens inside a detached continuation and becomes a host unhandled rejection (see 2). Fix: treat non-extensibility as an immutable mark in itself — `hasImmutableMark` gains `|| !Object.isExtensible(value)`, `markImmutable` returns early when not extensible. Frozen ⇒ COW-on-write, semantically exactly right.

2. **[test/code] Rejected promises assigned to properties must become Error values.** This is the important runtime behavior: data promises can reject, including promises that are already rejected when assigned, and the property/mirror must receive the resulting Error node through the normal writeback path. `settlePromise` is the load-bearing mechanism for this; every promise continuation must go through it, not raw `.then`. Exceptions thrown inside runtime continuation bodies are internal bugs and should be fatal; do not catch or convert them into language Error values.

3. **[code] `importValue(promise)` breaks the one-layer wrapper contract.** index.js:134 chains `markImmutable(value).then(...)` — three hops instead of the uniform two, the single non-uniform registration site in the codebase. Safe today (root mark + inherited-immutable state protect walks despite the late rescan), but it violates the invariant helpers.js declares load-bearing. The fix is also a simplification:

   ```js
   function importValue(value, rescan = true) {
       if (isPromise(value)) return onResolve(value, v => importResolvedValue(v, rescan))
       return importResolvedValue(value, rescan)
   }
   ```

   (`importResolvedValue` already marks + scans, and the rejected-promise→Error path still works because `isTracked` rejects Errors.)

4. **[code] `assignPath(root, [], promiseValue)` returns the raw promise**, which can *reject* — the spec says "a rejecting return value shall be resolved as Error." A consumer awaiting the returned root directly gets a throw. Fix: `return isPromise(value) ? settlePromise(value) : value` for the empty path.

5. **[test] Add the forked-world rejection test.** The suite tests direct mid-path rejection but not rejection after a COW fork. Works today (probe-verified: the Error node lands in both worlds), but it is the classic regression for the fork initializer — pin it: fork a pending branch (suspended writes on both worlds), reject the promise, assert an Error node lands in both the source and the copied world, with no unhandled rejection.

6. **[doc] Spec: state the environmental pillar.** Two sentences missing from initial-spec.md: (a) resume-slice atomicity — each resumed slice runs synchronously to its next suspension and registers on nested promises before any later op's slice runs, which is what makes FIFO compose across multi-promise paths; (b) all of this rests on single-threaded microtask semantics (registration-order continuations, atomic slices) and would not survive shared state across workers.

7. **[comment] Document the mirror-clearing asymmetry.** The sync path clears the mirror on replacement (index.js:288) while the suspended path keeps it alive and advances `currentValue` (index.js:277–281). Correct — a settled-and-written-back mirror has no pending consumers, a suspended one does — but subtle enough that the sync branch deserves the one-line comment.

## Next layer — normalize / hasError / CLEAN

8. **[code] Implement `normalize` and `hasError`.** Absent from the exports; `propagateClean` / `updateCleanCounts` are stubs (helpers.js:43–49). The main remaining spec coverage gap; items 9–12 attach to this work.

9. **[doc] Decide import Error semantics first.** De facto in the kernel, Error objects inside imported data behave as language Error nodes (not tracked, not marked, propagate from lookups, block intermediate writes). Decide in one sentence whether they count as errors for CLEAN/hasError/normalize before those land.

10. **[code] Termination for full-tree walks.** Kernel walks are path-bounded and the import rescan has a `seen` set, but normalize/hasError/CLEAN add full-tree walks where writeback-created cycles (external code resolving a promise with a language object it received earlier) would not terminate. Fix: visited-gate on those walks, and/or reachability check on writeback of externally-resolved values. Keep independently switchable from 11 — this is a termination rule.

11. **[code] Identity map for DAGs in `normalize(full)`.** Lookup-shared subtrees are DAGs; without an old→new identity map, diamonds duplicate exponentially. One visited/identity map may serve both 10 and 11, but state as two rules — the map does double duty only if consulted *before* recurse. Add the principle line: COW deliberately does not preserve internal aliasing. Give `normalize` its root parameter.

12. **[code] `parents` retention.** In the CLEAN machinery, `parents` as strong upward refs retains every COW'd-away ancestor forever. Use WeakRefs, or prune stale edges during the validation step.

## Language integration

13. **[code] Frames-as-nodes.** Treat scope frames as nodes with variables as keys, so a pending root is an ordinary promise-valued edge and the whole mirror machinery applies unchanged with path `['varName', ...path]`. Not a kernel prerequisite (the `settlePromise` re-entry at the top of each op is FIFO-correct and reuses the same resume protocol; composition works because the language rebinds the variable to each op's return), but at language level it removes the per-op derived-promise chain on pending roots.

14. **[compiler] Enforce the single-owner rule.** The kernel cannot detect a raw (unimported, unshared) promise assigned to two locations; the compiler must guarantee it never emits that — external values enter through `import`, escapes through shared-ownership `lookupPath`.
