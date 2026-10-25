# Independent check of R3, run 04

Reviewer: `/root/missed_delivery_semantics`. R3 is independently reproduced as a supported B18 lifetime defect. The checked source/test candidate remains `57f37a8ce537797856fcbae1346f27e3b43fec8f5d4ae58f413fe6876e52f88e` on Node v24.14.1. No production or test-suite changes were made.

The original [12-case preparation probe](2026-10-25-04-lifetime-preparation-controls.mjs) reproduced its two invalid-comparator failures. A separate [24-case probe](2026-10-25-04-delivery-lifetime-probe.mjs) then removes the original harness's `pending.original` property and manual thenable flushing. It extends comparator preparation to observational `sort`, mutating `sort`, and `toSorted`, with ready, synchronously delivered, native-Promise and ordered-thenable inputs. Healthy comparator controls attach the watched payload to a valid Function and check successful sorting. Each case clears its Chain and all local input references, retains the execution and unformatted failure, and watches the payload, receiver and original input separately.

The independent probe has **six failing cases**: an invalid object comparator delivered asynchronously on each of the three routes, using native or ordered delivery. The payload survives; the receiver and original input Promise/thenable collect. The other 18 cases collect all watched objects, including all 12 healthy controls. The same six failures reproduce at stack limits 10, 50 and 1,000. Two diagnostic runs, dropping the retained poison or formatting its stack, collect everything. Those runs diagnose stack retention; formatting or dropping diagnostics is not a runtime correction.

[Execution evidence](2026-10-25-04-delivery-lifetime-evidence.json) records the five final commands, environments, probe hash, exact failing rows and an extracted path from a separately generated heap snapshot. Counts refer to 24 scenarios, not 120 independent cases across repeated executions.

## Boundary and causal check

An object in a comparator position is invalid application input, which the runtime explicitly handles as `NotAFunction`. It is not forged control state, a modified primordial, or a thenable/storage-contract violation. The ordered source settles once through its ordinary queue. The validation poison has the expected operation context and no semantic requirement to retain the rejected comparator. Mutating `sort` may retain a recovery baseline until the owner is cleared; this probe clears that owner, and its receiver collects. AGENTS.md's operation-lifetime contract explicitly requires spent source bindings to be cleared while unformatted poison remains retained.

`array-methods.js:comparatorInput` resumes through `internal-step.js:continueGraphTransition`, validates the delivered object and creates the poison. `language-values.js:thenValue` places the then-inspection closure and the delivery closures in one lexical scope. Its `value` parameter is used by the inspection closure and `Reflect.apply`; the delivery closure still links to the containing context after subscription has returned. A lazy native Error stack can retain that closure and therefore the spent `value` binding.

The independently generated snapshot contains this strong path (all edges are non-weak):

```text
PoisonError #102367
  -> lazy stack array #102421
  -> CallSiteInfo #102631
  -> delivery closure #102665 (script: src/language-values.js)
  -> closure context #102747
  -> parent context #89923
  -> value: Promise #89927
  -> settled result: comparator payload #89941
```

This is a **settled intermediate preparation Promise**, not the original host input: the independent probe proves the original input is collected. It also excludes receiver retention and the original harness's convenience property as causes. Reading the first author's snapshot produces the same kind of path, with different node identities. The durable evidence preserves the independent path and closure-script metadata; the portable probe can regenerate a snapshot using `SNAPSHOT`.

## Scope of the conclusion

The defect is confirmed for asynchronous invalid comparator preparation on `sort` observation, `sort` mutation and `toSorted`. These methods share `comparatorInput`, so they establish sibling-route coverage, not three unrelated failures. The source retaining path reaches the shared continuation helper, making its other callers relevant to a correction review. This review does **not** establish that all guarded continuations, other argument validators, or every thenable source leak. The original fill/concat controls pass, and the healthy comparator controls pass.

A correction should release the helper's source after its last required access while preserving synchronous delivery, callback receiver use, continuation ordering and exact Error/fatal behavior. No candidate fix was implemented or validated here. R3 remains open.
