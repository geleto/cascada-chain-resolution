# Imported data

`import(value, operationContext)` is the inbound host-data boundary. `operationContext` carries the execution and source-error information. Imported managed data is borrowed: Cascada stores metadata externally and never modifies its host representation.

## Context roots

Ordinary `Chain(initialValue, operationContext)` construction admits existing Cascada data without importing it. `ContextChain(initialValue, operationContext, scopeMutationPaths, propertyMutationPaths)` sends its raw host root once through the same importer. Two empty path Arrays import the context but build no external mutation tree.

`apis.data!.write()` contributes `["apis", "data"]` to `scopeMutationPaths`. `apis.data.status = value` and `delete apis.data.status` contribute `["apis", "data", "status"]` to `propertyMutationPaths`.

During the initial synchronous import segment, only those paths are searched. A property mutation path follows only its containing path; it never scans the old target. A scope mutation path follows its complete scope and searches the reached managed subtree. If traversal reaches external state while following either path, record that first boundary and stop the opaque suffix. Cut cycle backedges, preserve distinct finite acyclic alias occurrences, and add nothing for paths containing no external state. The tree grants the only possible external mutation locations.

External-tree discovery remains an occurrence walk separate from identity admission. Admission inspects each identity once, while discovery must preserve every distinct finite alias path. Request-prefix merging and cached acyclic subtree results avoid repeated reflection. Both walks belong to the same import transaction, so failure commits neither admission facts nor tree leaves.

## Admission walk

Each available synchronous segment uses one transactional identity walk:

1. Recognize native Errors and classify every other newly reached identity from its declarations and defaults.
2. Traverse new managed records, Arrays, and class instances once while preserving aliases and cycles.
3. Stop at external identities, Functions, and Errors.
4. Capture each reached Promise placement without awaiting it.
5. Commit admission, origin, sharing, Promise mirrors, and fixed Error versions only after the complete segment validates.

The walk inspects only own enumerable string-keyed data properties. It neither invokes accessors nor inspects non-enumerables. A supported enumeration, descriptor, validation, or host-reflection failure returns a contextual language Error for that whole synchronous segment and commits nothing from it; an existing contextual Error remains data and an internal failure is fatal. A native Error at the root returns its occurrence wrapper. A nested native Error remains physically unchanged while the importer stages its wrapper as that placement's fixed logical version.

An already admitted identity keeps its category and origin and is not rescanned. When importing it adds another owner, an admitted managed identity is marked shared. Import builds no refcount index.

Public `import(value, operationContext)` creates no static external mutation tree. External identities admitted through it remain observation-only even when its result later becomes an ordinary Chain root; only initial ContextChain import may establish mutation authority.

## Promise boundaries

A direct Promise root returns one operation Promise. Fulfillment completes the same import before exposing its value. Rejection remains rejection, with a raw reason contextualized to the import operation and an existing contextualized reason preserved.

A nested Promise belongs to its captured property version. Its fulfillment imports newly exposed data before publishing the logical value, while rejection publishes a contextual language Error attributed to this import boundary. Imported physical storage keeps the original Promise; the mirror stores its logical settlement without writeback. Runtime-owned Promise properties retain ordinary writeback.

Import owns the processor for each newly available fulfillment segment. Property-version code owns its placement overlay and settlement, then delegates the fulfilled payload through that processor. Keep this boundary to one handoff; do not add an `ImportTransaction` class or forward separate installation callbacks.

## Ownership

New imported managed identities are marked imported and shared, so mutation copy-on-writes before changing them. Copies are runtime-owned; reused imported children keep their origin. Frozen, sealed, and writable imported managed objects therefore have the same logical behavior.

Application code must not mutate managed data after passing it to Cascada. External identities remain exact leaves and are observation-only until external-operation support supplies explicit authority.

## Modules

- `src/import.js` owns the public boundary and direct-Promise completion.
- `src/import-preparation.js` owns the transactional admission walk and the processor reused for imported Promise fulfillments.
- `src/meta.js` owns declarations, admitted facts, and origin metadata.
- `src/property-versions.js` owns placement overlays, captured Promise settlement, and fixed imported-Error versions; it delegates an imported fulfillment to the import-owned processor.
