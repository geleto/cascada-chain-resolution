# Imported graph preparation

`import(value, errorContext)` is the boundary for external data. It establishes
shared ownership and attribution, prepares aliases and cycles in the reachable
graph, and registers continuations for nested Promises. Subtree counters remain
lazy until `export`, `hasError`, or `getErrors` needs them.

This document describes the implemented cycle-Error model. The chosen future
cycle-cut model is specified separately in
[`future/cycles-as-data.md`](future/cycles-as-data.md).

## Boundaries

A direct import boundary stores:

```js
{ root, errorContext }
```

The context must be truthy. The boundary root is marked shared, and the first
direct boundary on an identity remains its attribution source.

Descendants inherit the nearest boundary while a walk remains inside imported
data; they do not all need direct boundary metadata. A value receives its own
boundary when it becomes independently usable, including extraction and
retention as an off-path COW child.

A metadata-free host object first reached by detached preparation is marked as
an imported original. Promise settlement never physically replaces a property
on such an object. A node that already has runtime META is a previously
prepared or runtime-owned island and is not reclassified as host-owned.

Non-extensible nodes use the metadata WeakMap fallback and are implicitly
shared.

## Root import

For a non-Promise root, import:

1. establishes the direct boundary;
2. synchronously prepares the reachable graph; and
3. returns the original value.

For a Promise root, import returns one derived Promise. Its value-facing
reaction converts rejection to a language Error when needed, establishes the
resolved root boundary, performs the same preparation, and only then exposes
the result.

Import preparation never builds subtree counters.

## Detached preparation

`prepareImportedData` performs an ordinary depth-first walk over logical own
enumerable properties. Each synchronous segment owns:

- `currentPath`, the active DFS ancestry; and
- `visited`, identities already entered in that segment.

For each tracked property value:

1. If the incoming property already has a cycle diagnostic, stop at it.
2. If the value is on `currentPath`, the incoming property closes a cycle.
   Mark the repeated identity shared, publish a cycle Error on that property,
   and do not enter it.
3. If the value is in `visited`, it is an alias already handled in this
   segment. Mark it shared and stop.
4. If the value already has META, treat it as a prepared/runtime-owned island.
   Mark it shared and scan it only for references into the current ancestry.
5. Otherwise create its META record, classify it as an imported original, add
   it to both sets as appropriate, and walk its logical properties.

META presence is the durable prepared-identity signal. This is sound because
external data reaches META-bearing runtime state only through import, and
compiler-created data is acyclic under the single-owner/COW contract.

`Object.keys` order gives deterministic discovery within one synchronous
segment.

## Prepared islands

Re-entering a prepared identity under a new ancestry can create a cycle even
though its own graph was prepared earlier. The fixed-path scanner checks that
identity's logical graph against an immutable copy of the entering ancestry.

The scanner:

- keeps one weak visited set because its comparison path never changes;
- stops at existing cycle diagnostics;
- follows logical mirror values;
- marks repeated identities shared; and
- reports whether a synchronous route reaches the fixed path.

A synchronous match belongs to the property that entered the prepared island.
It must not be stored on an inner shared node: that cut depends on the entering
placement and would survive as a phantom if that placement were later revoked.

A Promise discovered inside the scanner is a new placement event. Its
continuation resumes the same fixed-path check, and any match belongs to that
Promise placement.

## Promise continuation

At a Promise property, preparation creates or reuses the property's mirror and
registers an import consumer at that FIFO position.

Detached preparation copies `currentPath` because the synchronous walk removes
ancestors while unwinding. When the Promise settles, the continuation:

1. starts from the latest logical value left by earlier mirror consumers;
2. resumes detached preparation with the copied ancestry and a fresh segment
   `visited` set;
3. keeps intrinsic cycles in newly exposed data on their actual DFS
   back-edges; and
4. prepares/ref-indexes the resulting logical value only if the mirror owner is
   already indexed.

A fixed-path continuation instead retains only its immutable comparison path
and scanner-local visited set.

The original detached-preparation consumer is registered before a later
fixed-path scan can discover the same Promise. FIFO therefore prepares fresh
resolved data first. If both consumers find the same placement-dependent
cycle, publication is idempotent and selects the Promise placement once.

Each import consumer is part of the mirror's pending-consumer drain. Later
operations cannot use the settled fast path until preparation at every earlier
FIFO position has completed.

## Imported attachment

`attachImportedDataToImportedData` handles an already imported value installed
within an imported mutation path. It is separate from detached preparation.

The mutation walk supplies the actual post-COW destination ancestry. Attachment
checks the entering value only against that fixed path:

- it does not grow the path with incoming nodes;
- it does not repeat detached preparation;
- a synchronous route into the path publishes the cut at the new owner/key
  placement; and
- a Promise resumes the same fixed-path scan at its own mirror position.

For an assigned pending attachment, the destination root is marked shared
before continuation registration. Later language mutations therefore COW away
and cannot change the captured ancestry.

A retained Promise fork also checks the ancestry captured at fork creation.
That internal classification does not create an observable pin.

The destination ancestry is captured after COW. References to an external
pre-copy owner therefore do not become false cycles in the new language-owned
world.

## Cycle projection

A cycle Error belongs to one owner/key property. The raw logical value is not
changed.

In the projected ref-index:

- the cut contributes `[0, 1]`;
- indexing does not follow the raw target;
- no reverse parent edge crosses the cut; and
- every projected parent graph remains acyclic.

Every raw directed imported cycle must contain at least one cut before
ref-indexing. A feedback edge may break more than one overlapping cycle, and a
strongly connected region may require several cuts.

The cut is always visible to projected consumers:

- a pending or draining mirror contributes `[1, 0]`;
- a published cycle Error contributes `[0, 1]`; and
- only `promiseCount === 0 && errorCount === 0` proves that the projected branch
  contains no hidden frontier.

The raw graph remains available where projection completeness is insufficient:

- finite lookup and mutation paths follow raw values;
- `getErrors` records the cycle Error and continues behind the cut;
- `export` reconstructs aliases and cycles; and
- raw traversal waits recursively for Promises found behind cuts.

Re-rooting a tracked identity does not remove a cycle in the underlying graph.
Replacing or deleting the exact cut property removes that placement's
diagnostic and count contribution. COW copies do not inherit placement
diagnostics blindly.

## Physical host data

Imported-original objects are physically unchanged by:

- Promise settlement;
- cycle discovery;
- ref-index construction; and
- language mutation.

Their mirrors remain the authoritative logical property state after settlement.
A runtime-owned extensible holder may receive the final mirror value
physically. A non-extensible holder retains its physical Promise and also reads
through the mirror.

Native code receives tracked Cascada values only through `export`, whose
output contains no runtime metadata or unresolved logical mirror state.

## Enumerable `__proto__`

An own enumerable `__proto__` property is ordinary language data. Preparation,
cycle discovery, mirrors, refcounting, Error queries, and export all
process it.

Every missing language key is created with `Object.defineProperty` as an own
enumerable data property. No runtime write invokes the inherited
`Object.prototype.__proto__` setter.

## Cost

Fresh detached preparation is O(n) in the synchronously reachable graph. A
prepared-island encounter adds a fixed-path scan for that ancestry. Promise
segments retain only the path and weak identity state required by their own
continuation.

Recursive synchronous graphs are bounded by the JavaScript call stack.
Permanently pending Promises may retain their continuation state, so identity
tables retained across them are weak.

## Module boundary

`src/import.js` owns:

- the public import boundary;
- detached preparation;
- the private fixed-path scanner;
- imported attachment;
- cycle-Error storage and read views; and
- imported Promise continuation registration.

`src/meta.js` owns generic metadata access and ownership marks.
`src/promise-mirrors.js` owns mirror lifecycle and logical reads.
`src/refcounts.js` consumes the prepared projection and owns attached
count/parent transitions.
