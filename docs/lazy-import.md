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
first reached a descendant, and commits the projected index. The occasional
wider walk buys one deterministic root and avoids having cycle placement depend
on which subpath happened to trigger preparation first.

Its private rooted preparation uses one operation-wide weak `visited` map and
one `currentPath` set. A tracked identity reached again is marked shared. The
map remembers which active ancestors that identity has already been checked
against, so a repeated branch is entered again only when the new path could
expose another back-edge. A property pointing into `currentPath` receives a
cycle Error and is not followed.

At a Promise property, the walk creates or reuses its mirror, copies
`currentPath`, and registers a continuation at that FIFO position. After earlier
consumers have prepared the latest `mirror.currentValue`, the continuation
calls the same walk on that value with the copied path and shared `visited` map.
Paths that add no unchecked ancestor are coalesced; a genuinely new ancestry
continues through the branch because a resolved edge may close a cycle there.

The walk publishes each fact as it finds it: duplicate marks, promise mirrors,
and cycle Errors. It builds no imported-node records and stores no preparation
flag. After its synchronous prefix, ordinary ref-indexing starts at the boundary
root and treats each pending mirror as `[1,0]`. Later Promise continuations
publish newly exposed aliases and cuts through the normal atomic edge/count
transition. The root's counter proves that initial preparation is installed.

`Object.keys` order, the stored root, copied Promise paths, and FIFO registration
define the chosen cycle cuts. Every synchronous segment is an ordinary DFS, and
every Promise continuation retains the ancestry needed to recognize a closing
back-edge. Cutting those edges leaves a finite projected graph, and normal
ref-indexing preserves exact alias multiplicity without a second import-specific
graph representation.

The optional write target stops discovery at the language-owned parent into
which a new value is being installed. It prevents inherited import provenance
from classifying the existing owner graph as external. The excluded mirror
prevents preparation from rediscovering the exact promise placement currently
being drained.

Discovery and ref-index construction are recursive. Import itself remains O(1),
but each deeply nested synchronous or settled Promise branch is bounded by the
JavaScript call stack. A repeated branch is revisited only for newly introduced
ancestors; this preserves path-sensitive cycle detection without expanding a
DAG once per structural path.

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

Valid compiler-created transitions cannot add aliases or cycles: values that
escape are marked shared and mutation COWs before placement. Imported Promise
results are different because host data may expose either. Their registered
continuations walk the resolved branch against the path captured at that FIFO
position. A Promise that resolves directly to an ancestor marks the Promise
placement; a resolved object containing that ancestor marks the actual property
inside the object. Existing cuts are not traversed again.

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
holder is external. Its mandatory writeback remains first; it makes a resolved
tracked value a new boundary and ref-indexes that value before the import
continuation walks it. The import consumer itself participates
in the same counted FIFO drain, so later operations cannot observe an
unclassified intermediate value. Earlier consumers may change `currentValue`;
the walk deliberately inspects that latest logical value rather than the raw
settlement.

An external holder keeps its exact physical Promise property after settlement;
the mirror owns the logical settled value. A language-owned assigned or COW-fork
holder writes the final drained value physically only while it remains
extensible. All logical operations read through the mirror, and host output uses
`normalize(..., plainCopy=true)` to materialize ordinary promise-free data.

## Module boundary

`src/import.js` owns:

- `import`: the public root boundary.
- `buildImportedRefIndex`: complete imported-value index orchestration.
- `prepareImportedPropertyTransition`: rooted imported preparation needed when
  a value enters an indexed property.
- cycle-Error storage, read views, and publication sequencing.

The rooted promise-recursive graph walk remains private. Generic metadata access
stays in `src/meta.js`, while `src/refcounts.js` supplies the generic index
commit and atomic attached-edge count transaction.
