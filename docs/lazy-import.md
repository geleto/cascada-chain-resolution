# Lazy import preparation

`import(value, errorContext)` is the external-data boundary. It requires a
truthy attribution context and marks only the imported root. For a promise
root, it returns one derived promise whose fulfilled value is marked before
runtime consumers see it. Import does not walk descendants, register nested
promises, detect aliases or cycles, or build counters.

This keeps the common case cheap. Imported variables that never use
`normalize`, `hasError`, or `getErrors` pay only for one root mark.

## Import boundaries

A direct import boundary stores `{ root, errorContext }` and marks its root
shared. Traversals carry that boundary through descendants without marking
each one imported. When extraction, COW reuse, or promise settlement makes an
imported value independently usable, that value becomes the root of a new
direct boundary with the same attribution.

Trusted language-created data never enters imported preparation. The compiler
gives a new value one owner, lookup marks values that escape, and mutation COWs
shared branches. Under that contract, trusted branches contain neither cycles
nor repeated tracked identities and need no graph table.

## Preparation

`buildImportedRefIndex` is the refcount layer's single entry for an imported
value. It always prepares from `importBoundary.root`, even when the operation
first reached a descendant, handles any closing placement edge, and commits the
projected index. The occasional wider scan buys one deterministic rule and
avoids having cycle placement depend on which subpath happened to be queried
first.

Its private rooted preparation creates one `visited` set and one `currentPath`
set, then calls its depth-first walker. On the first visit to a tracked
identity, the walker descends into it. On a repeat, it marks that identity
shared and does not descend again. If the repeated identity is also in
`currentPath`, the property pointing back into the active path receives a cycle
Error.

The walk publishes each fact as it finds it: duplicate marks, promise mirrors,
and cycle Errors. It builds no imported-node records and stores no preparation
flag. After the walk, ordinary ref-indexing starts at the boundary root and
uses the committed cycle cuts. The root's counter is then sufficient proof
that the boundary has already been prepared.

`Object.keys` order and the stored root make the chosen cycle cuts stable.
Every directed cycle contains a back-edge in this depth-first walk; cutting
those back-edges leaves every node reachable through the DFS tree, so the
normal ref-index walk can preserve exact alias multiplicity without a second
import-specific graph representation.

The optional write target stops discovery at the language-owned parent into
which a new value is being installed. It prevents inherited import provenance
from classifying the existing owner graph as external. The excluded mirror
prevents preparation from rediscovering the exact promise placement currently
being drained.

Discovery and ref-index construction are recursive. Import itself remains
O(1), but the first counter-based operation on a very deep imported graph is
therefore bounded by the JavaScript call stack.

Only repeated imported identities receive their own shared mark. Unique
descendants remain protected by the inherited shared branch. Non-extensible
nodes are implicitly shared and use the metadata WeakMap fallback when they
need mirrors, counters, or cycle Errors.

## Cycles and aliases

A cycle Error belongs to one owner/key placement. The raw property is not
changed. The projected counter graph cuts that edge and counts it as `[0, 1]`,
so parent propagation remains acyclic. Lookup and mutation continue through
the raw value, while `hasError` and `getErrors` report the Error and normalize
can reconstruct the original topology.

An edge added later is handled incrementally. Rooted preparation discovers
cycles internal to the value first. A private closing-edge scan then asks
whether the proposed owner/key edge can reach its owner through the projected
graph. If it can, only that known closing edge gets a fresh cycle Error.
Existing cuts are never crossed by this reachability check.

## Enumerable `__proto__`

An own enumerable `__proto__` property is ordinary imported data. Discovery,
mirrors, counters, error queries, and normalization all process it. The
inherited legacy accessor and own non-enumerable properties are outside the
language-visible property surface.

Every physical language write defines a missing key as an own enumerable data
property. COW, plain-copy normalization, assignment, and promise writeback can
therefore create or replace `__proto__` without invoking JavaScript's legacy
prototype setter or changing the object's prototype.

## Promises

Preparation mints mirrors for pending imported properties at their discovery
position. Each mirror carries the inherited import boundary and whether its
holder is external. On settlement, the resolved tracked value becomes a new
boundary rooted at itself and is prepared before later FIFO consumers inspect
it.

An external holder keeps its exact physical Promise property after settlement;
the mirror owns the logical settled value. A language-owned assigned or COW-fork
holder writes the final drained value physically only while it remains
extensible. All logical operations read through the mirror, and host output uses
`normalize(..., plainCopy=true)` to materialize ordinary promise-free data.

## Module boundary

`src/import.js` owns:

- `import`: the public root boundary.
- `buildImportedRefIndex`: complete imported-value index orchestration.
- `prepareImportedPropertyTransition`: imported value preparation for a new
  indexed property placement.
- cycle-Error storage, read views, and publication sequencing.

The rooted graph walk and closing-edge scan remain private. Generic metadata
access stays in `src/meta.js`, while `src/refcounts.js` supplies the generic
index commit and atomic attached-edge count transaction.
