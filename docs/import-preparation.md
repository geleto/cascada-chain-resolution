# Imported data

## Causal admission

The context importer uses `ContextValueFailed`; causal host-result import uses `InvocationFailed` for ready native Errors and direct/nested rejections. Each first existing continuation retains its operation context and kind. `consumeValue` classifies initial inputs before ordinary admission; `admitReadyValue` accepts poison and treats an unclassified native Error as a missed-boundary defect. Shared settlement and copied versions preserve already contextualized values without assigning a consumer source. Fixed overlays hold native-Error wrappers without changing imported storage. Equivalent wrappers need no interning, including across import segments. Supported reflection uses the exact external-action marker and the segment's `ImportReflectionFailed` consumer; unrelated staging/bookkeeping failures remain fatal.

`import(value, operationContext)` is the inbound host-data boundary. `operationContext` carries the execution and source-error information. Imported managed data is borrowed: Cascada stores metadata externally and never modifies its host representation.

## Context roots

Ordinary `Chain(initialValue, operationContext)` admits existing Cascada data without importing it. `ContextChain(initialValue, operationContext, mutationAccessTree = undefined)` sends its raw host root once through the common importer. The compiler provides a finite tree of static mutation access prefixes, with property maps at every node and `{}` endpoints. Omission means no requests; `{}` requests only the root. Calls contribute receiver routes and property mutations contribute containing routes, independently of poison scopes. [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree) defines the complete compiler contract.

Build the runtime tree during the initial synchronous segment from the original source inputs and staged/admitted categories. Follow only requested own placement keys. The first external identity becomes a boundary record and ends that branch, even if its compiler node has children. Remove non-external endpoints and prune empty connecting branches. The compiler retains its unchanged tree; build only the resulting runtime branches and records and release all compiler input references before construction returns.

Authority discovery is a finite occurrence walk, separate from identity admission. Every recursive step consumes a compiler-tree edge, so aliases and context cycles require no subtree enumeration, relative-path cache, or cycle-cut mechanism. Preserve explicitly selected distinct locations for duplicate-identity validation. Discovery adds no reflection beyond its requested prefixes and never enumerates an unrequested managed subtree; ordinary import retains its one-per-identity admission walk.

Stop discovery at every original Promise or thenable, even when ordinary import has synchronously delivered or previously settled its logical overlay. Root thenable delivery receives no discovery setup. Reuse category facts without another thenability probe or subscription. Errors and Functions retain their classification precedence. Ordinary import keeps its logical placement reader and normal thenable consumption; discovery reads original placement inputs instead. Mutable resources must be directly accessible, so all tree construction and registration finish before ContextChain construction returns.

Admission, origin, sharing, placement versions, runtime records, and identity bindings commit atomically. Stage an identity-to-location map alongside the import segment. Two distinct selected locations for one exact identity fail with `ExternalLocationConflict` before any registration, preserving existing bindings. A thenable-only or unselected alias creates no claim. A supported discovery reflection failure abandons the same segment; its pending callbacks cannot later admit or publish. The boundary record and its Symbol-valued entry, exact-value validation, and fixed namespace are specified in [external context ordering](external-context-ordering.md#runtime-nodes-and-identity-validation).

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

Public `import(value, operationContext)` creates no static external mutation tree. An unregistered external identity remains observation-only; an already registered identity keeps its binding and access restrictions through every alias. Import cannot downgrade it to freely observable data. Only initial ContextChain import may establish mutation authority.

## Promise boundaries

A custom root thenable consumed synchronously returns the ready imported root directly. If used as a ContextChain root it grants no external mutation authority: the original root was not directly accessible, even though ordinary import completed synchronously. An actually pending root returns one operation Promise. Its causal completion finishes the same import before exposing the value or ordinary contextual Error. Raw rejection receives the import source and kind; an existing contextualized Error is preserved. A supplied PoisonedValue delivers its ordinary Error through the supported rejection callback and is never admitted as graph data.

A nested pending Promise belongs to its captured property version. Its fulfillment imports newly exposed data before publishing the logical value, while rejection publishes a contextual language Error attributed to this import boundary. Imported physical storage keeps the original Promise; the Promise version stores its logical settlement without writeback. A custom thenable that delivers synchronously is already final for this segment: runtime-owned storage publishes its final value directly, while unchanged imported storage uses a fixed logical overlay rather than a Promise version. Runtime-owned pending Promise properties retain ordinary writeback.

Import owns the processor for each newly available segment. Synchronous delivery joins the active staged walk; later delivery for a committed placement starts a new segment at its existing FIFO position and cannot add external-tree leaves. The importer registers its own delivery transition and publishes the prepared value through the ordinary property-version commit. Property-version code owns the committed placement's overlay and bookkeeping without calling back into import. The same staged version becomes the pending Promise version when needed; no installer callback, `ImportTransaction` class, second overlay store, or configurable walker is required.

## Ownership

New imported managed identities are marked imported and shared, so mutation copy-on-writes before changing them. Copies are runtime-owned; reused imported children keep their origin. Frozen, sealed, and writable imported managed objects therefore have the same logical behavior.

Application code must not mutate managed data after passing it to Cascada. External identities remain exact leaves. Initial context discovery reuses one segment-local identity-to-location map to detect duplicate locations and commit registrations after validation. Binding state follows [external-context-ordering.md](external-context-ordering.md#identity-binding-map). A regular Chain's inert admission cannot disqualify a later context, and an abandoned segment cannot invalidate an existing binding.

## Modules

- `src/import.js` owns the public boundary and direct-Promise completion.
- `src/import-preparation.js` owns the transactional admission walk and the processor reused for imported Promise fulfillments.
- `src/meta.js` owns declarations, admitted facts, and origin metadata.
- `src/property-versions.js` owns placement overlays, fixed logical versions, and the atomic commit used by the import-owned delivery transition.

## Ownership across external boundaries

Mutation paths select external authority without changing managed admission or ownership. Managed aliases and cycles retain their ordinary import semantics, even across those paths; new imported managed identities remain shared. Paths containing no directly accessible external boundary add no tree node. Import creates no separate capture selector or per-scope ownership map.

External code may retain a read-only reference to a managed identity, but must not mutate it even through an external receiver's child property. Native writable state stays within its declared external owner; an explicitly external record may own plain state together with native services. Property observations from mutable external state provide detached managed snapshots. Host-method results instead follow ordinary import, so the host must return independent data or relinquish mutation of the returned managed graph. See the [ownership boundary](external-context-ordering.md#managed-and-external-ownership).
