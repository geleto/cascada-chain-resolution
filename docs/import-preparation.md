# Imported graph preparation

`import(value, errorContext)` is the external-data boundary. It requires a
truthy attribution context, marks the imported root, and immediately walks the
detached external graph. The walk records cycle-closing properties and
registers imported Promise continuations. For a promise root,
`import` returns one derived promise that performs the same preparation before
runtime consumers see its value. Import never builds subtree counters; those
remain lazy until `normalize`, `hasError`, or `getErrors` needs them.

## Import boundaries

A direct import boundary stores `{ root, errorContext }` and marks its root
shared. Traversals carry that boundary through descendants without marking
each one imported. Extraction or COW reuse can make a descendant independently
usable and therefore creates a new direct boundary with the same attribution.
A nested Promise result remains part of its existing imported graph and
inherits that boundary. A root Promise result receives a boundary because it is
itself the value entering through `import`.

Trusted language-created data never enters imported preparation. The compiler
gives a new value one owner, lookup marks values that escape, and mutation COWs
shared branches. Under that contract, trusted branches contain neither cycles
nor repeated tracked identities and need no graph table.

## Preparation

`prepareImportedData` owns detached graph preparation and runs once when a
direct boundary is created. It creates one weak `visited` map shared by every
Promise continuation. Each synchronous DFS segment has one identity token and
one `currentPath`. A node already mapped to that segment token is skipped. A
tracked identity already in `currentPath` closes a cycle: that property receives
a cycle Error and is not followed.

At a Promise property, the walk creates or reuses its mirror, copies
`currentPath`, and registers a preparation consumer at that FIFO position.
After earlier consumers leave the latest `mirror.currentValue`, this consumer
resumes the same detached walk with the inherited boundary, copied path,
the preparation's `visited` map, and a fresh segment token. The copied path
detects references back into the pre-Promise ancestry while the fresh token
allows this segment to revisit nodes previously checked under another ancestry.
Ordinary path growth detects cycles inside the resolved graph. Distinct Promise
placements retain distinct copied paths because either one may close a
different cycle.

The walk publishes promise mirrors and cycle Errors as it finds them. It builds
no imported-node records and gives DAG aliases no permanent mark. Ordinary
ref-indexing later starts at the already prepared boundary root, preserves
structural alias multiplicity, and treats each pending mirror as `[1,0]`.

`Object.keys` order, the stored root, copied Promise paths, and FIFO registration
define the chosen cycle cuts. Every synchronous segment is an ordinary DFS, and
every Promise continuation retains the ancestry needed to recognize a closing
back-edge. Cutting those edges leaves a finite projected graph, and normal
ref-indexing preserves exact alias multiplicity without an import-specific
graph representation.

`prepareImportedData` starts with no containing parent and is scoped to the
connected graph reached from one stored import root. A back-reference within
that graph points into `currentPath`, so its closing property receives a cycle
Error and is not entered. The walk follows nested direct import boundaries and
uses the nearest boundary's attribution. Eager first discovery also fixes the
first cycle attribution; a later direct import does not relocate an existing
cut.

Ordinary language assignment cannot connect imported data back into a
language-owned parent: values exposed to host code are shared, and mutation
COWs the path before placement. Assignment within imported data is checked by
the separate attachment operation after that COW. An imported Promise may also
expose more host data; its detached continuation starts with the imported path
captured when the Promise property was discovered. Disconnected imports need
no shared or global cycle state.

Discovery and ref-index construction are recursive. Import is O(n) in the
synchronously reachable external graph, and each deeply nested synchronous or
settled Promise branch is bounded by the JavaScript call stack. Each Promise
continuation uses a fresh segment token with the preparation's weak visited map
and its immutable copied ancestry.

Imported descendants remain protected by their inherited shared boundary;
aliases need no permanent shared mark. A cycle target is marked shared because
the new cyclic placement makes that identity reachable through another path.
Non-extensible nodes are implicitly shared and use the metadata WeakMap fallback
when they need mirrors, counters, or cycle Errors.

## Attachment

`attachImportedDataToImportedData` is separate from detached preparation. It
runs only when assignment places an already-imported value within an imported
path. The mutation walk supplies the actual destination ancestry after any COW,
so references to the pre-copy external owner do not become false cycles.

Attachment keeps that ancestry fixed. It does not add incoming nodes to the
path or reuse detached preparation's visited map. Its own weak visited set
suppresses every repeated tracked node because the comparison path never
changes. A value equal to a destination ancestor closes a cycle at its owner/key
placement.

The operations remain distinct across Promise barriers. A Promise discovered
by detached preparation resumes the detached walk with its copied current path.
A Promise reached by attachment resumes the attachment walk with the same fixed
destination path. Neither continuation invokes the other operation. Both use
the placement's mirror and counted FIFO consumer, so all required imported
classification finishes before the value is indexed.

## Cycles and DAGs

A cycle Error belongs to one owner/key placement. The raw property is not
changed. The projected counter graph cuts that edge and counts it as `[0, 1]`,
so parent propagation remains acyclic. Lookup and mutation continue through
the raw value, while `hasError` and `getErrors` report the Error and normalize
can reconstruct the original topology.

Valid compiler-created transitions cannot add aliases or cycles: values that
escape are marked shared and mutation COWs before placement. Imported data may
contain a DAG, which refcounting represents with exact edge multiplicity without
permanently marking duplicate descendants. Imported Promise results may expose
new cycles. Their registered continuations resume detached preparation with the
path captured at that FIFO position. A Promise that resolves directly to an
ancestor marks the Promise placement; a resolved object containing that ancestor
marks the actual property inside the object. Existing cuts are not traversed
again.

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
holder is external. Its mandatory writeback remains first, but an imported
mirror deliberately records only the raw logical value there. The following
import consumers resume only their registering walks: detached preparation uses
its copied path and attachment uses its fixed destination path.
`importPreparationCount` delays indexing until all of them finish. Every import
consumer participates in the same counted FIFO drain, so later operations cannot
observe an unclassified intermediate value. Earlier consumers may change
`currentValue`; each walk deliberately inspects that latest logical value rather
than the raw settlement.

An external holder keeps its exact physical Promise property after settlement;
the mirror owns the logical settled value. A language-owned assigned or COW-fork
holder writes the final drained value physically only while it remains
extensible. All logical operations read through the mirror, and host output uses
`normalize(..., plainCopy=true)` to materialize ordinary promise-free data.

## Module boundary

`src/import.js` owns:

- `import`: the public root boundary.
- `buildImportedRefIndex`: complete imported-value index orchestration.
- `prepareImportedData`: private promise-recursive cycle preparation.
- `attachImportedDataToImportedData`: fixed-path imported placement checking.
- cycle-Error storage, read views, and publication sequencing.

Both recursive walks remain private behind those operations. Generic metadata
access stays in `src/meta.js`, while `src/refcounts.js` supplies the generic
index commit and atomic attached-edge count transaction.
