# Imported data

## Causal admission

The context importer uses `ContextValueFailed`; causal host-result import uses `InvocationFailed` for ready native Errors and direct/nested rejections. Each first existing continuation retains its operation context and kind. `consumeValue` classifies initial inputs before ordinary admission; `admitReadyValue` accepts poison and treats an unclassified native Error as a missed-boundary defect. Shared settlement and copied versions preserve already contextualized values without assigning a consumer source. Fixed overlays hold native-Error wrappers without changing imported storage. Equivalent wrappers need no interning, including across import segments. Supported reflection uses the exact external-action marker and the segment's `ImportReflectionFailed` consumer; unrelated staging/bookkeeping failures remain fatal.

`import(value, operationContext)` is the inbound host-data boundary. `operationContext` carries the execution and source-error information. Imported managed data is borrowed: Cascada stores metadata externally and never modifies its host representation.

## Context roots

Ordinary `Chain(initialValue, operationContext)` construction admits existing Cascada data without importing it. `ContextChain(initialValue, operationContext, scopeMutationPaths, propertyMutationPaths)` sends its raw host root once through the same importer. Two empty path Arrays import the context but build no external mutation tree.

`apis.data!.write()` contributes `["apis", "data"]` to `scopeMutationPaths`. `apis.data.status = value` and `delete apis.data.status` contribute `["apis", "data", "status"]` to `propertyMutationPaths`.

During the initial synchronous import segment, only those paths are searched. A property mutation path follows only its containing path; it never scans the old target. A scope mutation path follows its complete scope and searches the reached managed subtree. If traversal reaches external state while following either path, record that first boundary and stop the opaque suffix. Cut cycle backedges, preserve distinct finite acyclic alias occurrences, and add nothing for paths containing no external state. The tree grants the only possible external mutation locations.

External-tree discovery remains an occurrence walk separate from identity admission. Admission inspects each identity once, while discovery must preserve every distinct finite alias path. Request-prefix merging and cached acyclic subtree results avoid repeated reflection. Discovery reads the segment's logical placements, including staged fixed overlays for synchronous custom outcomes, as well as its staged admission facts. It never resubscribes to physical thenables or requires early overlay publication. Both walks belong to the same import transaction, so failure commits neither admission facts nor tree leaves. Before commit, staged discovery requires one normalized boundary location per exact external identity. Repeated discovery of the same location merges; a distinct second location returns import-attributed `ExternalLocationConflict` and abandons the complete initial segment, including any pending publication work. This applies to conservative scopes and synchronous custom deliveries. Existing identity bindings remain unchanged, including when this rejected import would otherwise compete with another context. Retain no candidate set or first-use path selection after import.

## Admission walk

Each available synchronous segment uses one transactional identity walk:

1. Recognize native Errors and classify every other newly reached identity from its declarations and defaults.
2. Traverse new managed records, Arrays, and class instances once while preserving aliases and cycles.
3. Stop at external identities, Functions, and Errors.
4. Consume each reached possible Promise at its program position. A synchronous custom outcome continues this segment; only a returned pending chain becomes a Promise-backed placement.
5. Commit admission, origin, sharing, pending Promise versions, and fixed logical versions only after the complete segment validates. A synchronous custom outcome over unchanged imported storage uses the same fixed-overlay mechanism as other final logical values that cannot be written physically.

Subscriptions made during validation share one segment-local lifecycle fact: `staging`, then either `committed` or `abandoned`. Reuse existing segment state if it expresses those transitions; otherwise retain one local state field, not independent Booleans or a transaction class. While staging, synchronous deliveries continue the same walk and identity map, while Error collection handles equivalence between any separately constructed contextual wrappers. Commit grants pending subscriptions authority to import and publish their later outcomes. Failed validation instead abandons that unpublished semantic work. Release the staging collections on either terminal transition, retaining only the lifecycle fact and captured placement work needed by already-owned reactions. A callback from an abandoned segment cannot admit data, create a Promise version or tree leaf, or publish; it returns after the common execution and segment checks. No committed shared version exists for it to settle. Keep rejection ownership explicit without cancelling the host source or registering subscriptions with the execution.

The walk inspects only own enumerable string-keyed data properties. It neither invokes accessors nor inspects non-enumerables. A supported enumeration, descriptor, validation, or host-reflection failure returns a contextual language Error for that whole synchronous segment and commits nothing from it; an existing contextual Error remains data and an internal failure is fatal. A native Error at the root returns its occurrence wrapper. A nested native Error remains physically unchanged while the importer stages its wrapper as that placement's fixed logical version. Separate raw-Error introductions may produce equivalent immutable wrappers. Collection deduplicates by raw cause, source-context identity, and kind; no Error identity map must survive a segment merely to intern wrappers. Existing contextualized Errors propagate by exact reference.

An already admitted identity keeps its category and origin and is not rescanned. When importing it adds another owner, an admitted managed identity is marked shared. Import builds no refcount index.

Public `import(value, operationContext)` creates no static external mutation tree. External identities admitted through it remain observation-only even when its result later becomes an ordinary Chain root; only initial ContextChain import may establish mutation authority.

## Promise boundaries

A custom root thenable consumed synchronously returns the ready imported root directly. An actually pending root returns one operation Promise. Its causal completion finishes the same import before exposing the value or ordinary contextual Error. Raw rejection receives the import source and kind; an existing contextualized Error is preserved. A supplied PoisonedValue delivers its ordinary Error through the supported rejection callback and is never admitted as graph data.

A nested pending Promise belongs to its captured property version. Its fulfillment imports newly exposed data before publishing the logical value, while rejection publishes a contextual language Error attributed to this import boundary. Imported physical storage keeps the original Promise; the Promise version stores its logical settlement without writeback. A custom thenable that delivers synchronously is already final for this segment: runtime-owned storage publishes its final value directly, while unchanged imported storage uses a fixed logical overlay rather than a Promise version. Runtime-owned pending Promise properties retain ordinary writeback.

Import owns the processor for each newly available segment. Synchronous delivery joins the active staged walk; later delivery for a committed placement starts a new segment at its existing FIFO position and cannot add external-tree leaves. The importer registers its own delivery transition and publishes the prepared value through the ordinary property-version commit. Property-version code owns the committed placement's overlay and bookkeeping without calling back into import. The same staged version becomes the pending Promise version when needed; no installer callback, `ImportTransaction` class, second overlay store, or configurable walker is required.

## Ownership

New imported managed identities are marked imported and shared, so mutation copy-on-writes before changing them. Copies are runtime-owned; reused imported children keep their origin. Frozen, sealed, and writable imported managed objects therefore have the same logical behavior.

Application code must not mutate managed data after passing it to Cascada. External identities remain exact leaves. The Phase 9C addendum preserves current inert tree entries; Phase 9E adds duplicate-location validation and the atomic context-registration behavior in [external-context-ordering.md](external-context-ordering.md#identity-binding-map). A regular Chain's inert admission cannot disqualify a later context, and an abandoned segment cannot invalidate an existing binding.

## Modules

- `src/import.js` owns the public boundary and direct-Promise completion.
- `src/import-preparation.js` owns the transactional admission walk and the processor reused for imported Promise fulfillments.
- `src/meta.js` owns declarations, admitted facts, and origin metadata.
- `src/property-versions.js` owns placement overlays, fixed logical versions, and the atomic commit used by the import-owned delivery transition.
