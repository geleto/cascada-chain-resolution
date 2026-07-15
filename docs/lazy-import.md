# Lazy import preparation

`import(value, errorContext)` is the external-data boundary. It requires a
truthy attribution context and marks only the imported root. For a promise
root, it returns one derived promise whose fulfilled value is marked before
runtime consumers see it. Import does not walk descendants, register nested
promises, validate a graph, or build counters.

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

1. Discover and validate without publishing metadata.
2. Commit shared marks, promise mirrors, cycle markers, and the prepared flag.

The discovery table interns each tracked identity once but records every
owner/key edge. This preserves alias multiplicity while avoiding repeated
work. A node first indexed as trusted is still inspected when it is later
reached under imported provenance; trusted counters do not imply imported
validation.

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
attributed `{ kind: "cycle", error }` edge mark. The raw property is not changed.
The projected counter graph cuts that edge and counts it as `[0, 1]`, so parent
propagation remains acyclic. Lookup and mutation continue through the raw value,
while `hasError` and `getErrors` report the marker.

An edge added later is handled incrementally. Candidate preparation first
finds intrinsic imported cycles. Refcounting then asks whether the proposed
owner/key edge can reach its owner through the projected graph. If so, only
that known closing edge gets a cycle marker. Existing cycle and validation
cuts are not crossed.

## Validation overlays

Imported own enumerable `__proto__` keys are prohibited. This is the only
language-data validation failure discovered by imported preparation. Promises
and Errors are valid enumerable values in extensible and non-extensible imports.

COW preserves an imported enumerable `__proto__` data slot physically using a
pre-created own property, then gives that new owner/key placement a fresh
attributed edge Error. The prohibited value therefore remains inaccessible and
cannot disappear from error queries merely because an unrelated property was
mutated.

A validation failure becomes an attributed `{ kind: "invalid", error }` edge
mark on the imported boundary placement containing the invalid subtree. The
host object and its raw property remain unchanged. The projected graph counts
the placement as `[0, 1]` and does not descend through it. Unlike a cycle mark,
an invalid mark is also an Error boundary for normalize.

Validation and SCC discovery are preparatory. A failed discovery publishes no
descendant shared marks, mirrors, counters, or parent edges. The edge-transition
layer installs a completed preparation against the live placement in one
synchronous commit.

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

Graph discovery, prohibited-key validation, and SCC helpers remain private.
Generic metadata access stays in `src/meta.js`; edge transitions and projected
counts stay in `src/refcounts.js`.
