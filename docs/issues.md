# Issues

## Basics — do first

1. **[bug] Importing a frozen/sealed object throws.** `markImmutable` uses `defineProperty` (index.js:60), which throws `TypeError: object is not extensible` on frozen input — and external data is exactly where frozen objects appear. When the frozen value arrives as a promise resolution, the throw happens inside a detached continuation and becomes a host unhandled rejection (see 2). Fix: treat non-extensibility as an immutable mark in itself — `hasImmutableMark` gains `|| !Object.isExtensible(value)`, `markImmutable` returns early when not extensible. Frozen ⇒ COW-on-write, semantically exactly right.

2. **[test/code] Rejected promises assigned to properties must become Error values.** This is the important runtime behavior: data promises can reject, including promises that are already rejected when assigned, and the property/mirror must receive the resulting Error node through the normal writeback path. `settlePromise` is the load-bearing mechanism for this; every promise continuation must go through it, not raw `.then`. Exceptions thrown inside runtime continuation bodies are internal bugs and should be fatal; do not catch or convert them into language Error values.

3. **[fixed] `importValue(promise)` breaks the one-layer wrapper contract.** `importValue(promise)` now uses `onResolve(value, v => importResolvedValue(v, rescan))`, so marking, rescanning, and rejected-promise→Error handling all go through the same promise wrapper contract as other runtime continuations.

   ```js
   function importValue(value, rescan = true) {
       if (isPromise(value)) return onResolve(value, v => importResolvedValue(v, rescan))
       return importResolvedValue(value, rescan)
   }
   ```

   (`importResolvedValue` already marks + scans, and the rejected-promise→Error path still works because `isTracked` rejects Errors.)

4. **[wontfix/spec] `assignPath(root, [], promiseValue)` may return the raw promise**, including a rejecting promise. This is valid Cascada behavior: the language error value is a special immediately-rejecting thenable, and Cascada consumers are already prepared to receive rejecting thenables/promises as error values. The sandbox represents errors with JavaScript `Error` objects in many internal paths, but the spec must not require wrapping every returned rejecting promise into an `Error` object.

5. **[fixed] Added the forked-world rejection test.** The suite now pins rejection after a COW fork: fork a pending branch, suspend writes on both forked worlds, reject the promise, and assert an Error node lands in the source and copied worlds with no unhandled rejection.

6. **[covered/no-op] Promise scheduling rule is already specified.** `initial-spec.md` already says operations run immediately, no operation is awaited before the next one is issued, and accessible promises must use `.then` and keep walking rather than pause execution. Cascada will not run this shared mutable state across workers, so no extra worker/microtask environment clause is needed.

7. **[fixed] Mirror-clearing asymmetry is commented.** Sync replacement clears the mirror; suspended replacement keeps and advances it.

## Next layer — CLEAN groundwork

8. **[doc] Decide import Error semantics first.** De facto in the kernel, Error objects inside imported data behave as language Error nodes (not tracked, not marked, propagate from lookups, block intermediate writes). Decide in one sentence whether they count as errors for CLEAN/hasError/normalize before those land.

9. **[code] Termination for full-tree walks.** Kernel walks are path-bounded and the import rescan has a `seen` set, but normalize/hasError/CLEAN add full-tree walks where writeback-created cycles (external code resolving a promise with a language object it received earlier) would not terminate. Fix: visited-gate on those walks, and/or reachability check on writeback of externally-resolved values. Keep independently switchable from 10 — this is a termination rule.

10. **[code] Identity map for DAGs in `normalize(full)`.** Lookup-shared subtrees are DAGs; without an old→new identity map, diamonds duplicate exponentially. One visited/identity map may serve both 9 and 10, but state as two rules — the map does double duty only if consulted *before* recurse. Add the principle line: COW deliberately does not preserve internal aliasing. Give `normalize` its root parameter.

11. **[code] `parents` retention.** In the CLEAN machinery, `parents` as strong upward refs retains every COW'd-away ancestor forever. Use WeakRefs, or prune stale edges during the validation step.

## Language integration

12. **[code] Frames-as-nodes.** Treat scope frames as nodes with variables as keys, so a pending root is an ordinary promise-valued edge and the whole mirror machinery applies unchanged with path `['varName', ...path]`. Not a kernel prerequisite (the `settlePromise` re-entry at the top of each op is FIFO-correct and reuses the same resume protocol; composition works because the language rebinds the variable to each op's return), but at language level it removes the per-op derived-promise chain on pending roots.

13. **[compiler] Enforce the single-owner rule.** The kernel cannot detect a raw (unimported, unshared) promise assigned to two locations; the compiler must guarantee it never emits that — external values enter through `import`, escapes through shared-ownership `lookupPath`.

14. **[later/code] Implement `normalize` and `hasError`.** Do this after the CLEAN flag implementation starts; both depend on that machinery. They are absent from the exports today, and `propagateClean` / `updateCleanCounts` are still stubs (helpers.js:43–49).
