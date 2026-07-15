# Lazy import preparation

`import(value, errorContext)` is the external-data boundary. It requires a
truthy attribution context and marks only the imported root. For a promise
root, it returns one derived promise whose fulfilled value is marked before
runtime consumers see it. Import does not walk descendants, register nested
promises, analyze a graph, or build counters.

This keeps the common case cheap. Imported variables that never use
`normalize`, `hasError`, or `getErrors` pay only for one root mark.

## Provenance

An import mark contains the attribution context and also makes its value
shared. Traversals carry that context through descendants without marking each
one imported. A new direct boundary is created only when a value must survive
independently, such as extraction, COW reuse, or promise settlement.

Trusted language-created data never enters imported preparation. The compiler
gives a new value one owner, lookup marks values that escape, and mutation COWs
shared branches. Under that contract, trusted branches contain neither cycles
nor repeated tracked identities and need no graph table.

## Preparation

`prepareImportedData(value, inheritedContext, writeTarget, excludedMirror)` is
called only when exact counters are required. It handles an imported region in
two stages:

1. Discover aliases and cycles without publishing metadata.
2. Commit shared marks, promise mirrors, cycle markers, and the prepared flag.

The discovery table interns each tracked identity once but records every
owner/key edge. This preserves alias multiplicity while avoiding repeated
work. A node first indexed as trusted is still inspected when it is later
reached under imported provenance; trusted counters do not imply imported
graph preparation.

The optional write target stops discovery at the language-owned parent into
which a candidate is being installed. It prevents inherited import provenance
from classifying the existing owner graph as external. The excluded mirror
prevents preparation from rediscovering the exact promise placement currently
being drained.

Discovery, SCC analysis, and ref-index construction are recursive. Import
itself remains O(1), but the first counter-based operation on a very deep
imported graph is therefore bounded by the JavaScript call stack.

Successful preparation marks every retained imported node shared and sets
`meta.importPrepared`, which prevents another full imported scan.
Non-extensible nodes use the metadata WeakMap fallback for that state and for
mirrors, counters, or placement metadata.

## Cycles and aliases

Discovery uses active/done state only to decide whether SCC analysis is
needed. A repeated completed node is a DAG alias; an active-node edge proves a
cycle. If no back-edge is seen, no Tarjan state is allocated. Otherwise one
Tarjan pass runs over the already-discovered records.

For a cyclic SCC, every intra-SCC owner/key placement receives its own stable
attributed cycle Error as its edge mark. The raw property is not changed.
The projected counter graph cuts that edge and counts it as `[0, 1]`, so parent
propagation remains acyclic. Lookup and mutation continue through the raw value,
while `hasError` and `getErrors` report the marker.

An edge added later is handled incrementally. Candidate preparation first
finds intrinsic imported cycles. Refcounting then asks whether the proposed
owner/key edge can reach its owner through the projected graph. If so, only
that known closing edge gets a cycle marker. Existing cycle cuts are not crossed.

## Enumerable `__proto__`

An own enumerable `__proto__` property is ordinary imported data.
Discovery, mirrors, counters, error queries, and normalization all process it.
The inherited legacy accessor and own non-enumerable properties are outside the
language-visible property surface.

Every physical language write defines a missing key as an own enumerable data
property. COW, plain-copy normalization, assignment, and promise writeback can
therefore create or replace `__proto__` without invoking JavaScript's legacy
prototype setter or changing the object's prototype.

SCC discovery is preparatory. The edge-transition layer installs completed
preparation against the live placement in one synchronous commit.

## Promises

Preparation mints mirrors for pending imported properties at their discovery
position. Each mirror carries the inherited import context and whether its
holder is external. Its resolved branch is prepared before later FIFO
consumers inspect it.

An external holder keeps its exact physical Promise property after settlement;
the mirror owns the logical settled value. A language-owned assigned or COW-fork
holder writes the final drained value physically only while it remains
extensible. All logical operations read through the mirror, and host output uses
`normalize(..., plainCopy=true)` to materialize ordinary promise-free data.

## Module boundary

`src/import.js` exports only:

- `import`: the public root boundary.
- `prepareImportedData`: the refcount layer's lazy preparation hook.

Graph discovery and SCC helpers remain private.
Generic metadata access stays in `src/meta.js`; edge transitions and projected
counts stay in `src/refcounts.js`.
