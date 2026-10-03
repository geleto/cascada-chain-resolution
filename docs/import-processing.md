# Imported data

**Implementation status:** common input preparation, complete parent registration, staged category filtering, placement validation, and prepared shape copying are implemented. Bounded retention, parent-derived ownership, and retirement are also implemented; later work is tracked in the [runtime evolution plan](runtime-evolution-plan.md).

## Causal admission

The context importer uses `ContextValueFailed`; causal host-result import uses `InvocationFailed` for ready native Errors and direct/nested rejections. Each first existing continuation retains its operation context and kind. `receiveValue` owns availability consumption, input preparation, and delivery capture for ordinary reception and import. Their policies preserve origin and causal Error differences; contextualized root Errors are admitted consistently. `admitReadyValue` accepts poison and treats an unclassified native Error as a missed-boundary defect. Shared settlement and copied versions preserve already contextualized values without assigning a consumer source. Fixed overlays hold native-Error wrappers without changing imported storage. Equivalent wrappers need no interning, including across import segments. Supported reflection uses the exact external-action marker and the segment's `ImportReflectionFailed` consumer; unrelated staging/bookkeeping failures remain fatal.

Preparation runs synchronously until each captured dependency returns pending. A supported `then` may invoke only its newly supplied callback during subscription; it cannot deliver older work or start a competing initialization. Synchronous delivery reuses the current staging walk and identity map. Later delivery starts a new segment after the current segment has committed or discarded. No deferred-subscription queue, initialization reconciliation, or inactive-frontier retention walk is needed.

Already-prepared ordinary roots return before allocating batch state unless context-tree discovery requires work. Method-result validation still follows borrowed pending placements through independent copies and preserves source attribution. Staging captures logical placements without normalizing borrowed storage; final commit performs no host action or subscription.

`import(value, operationContext)` is the inbound host-data boundary. `operationContext` carries the execution and source-error information. Imported managed data is borrowed: Cascada stores metadata externally and never modifies its host representation.

## Context roots

Ordinary `Chain(initialValue, operationContext)` prepares and admits existing Cascada data without importing it. `ContextChain(initialValue, operationContext, mutationAccessTree = undefined)` sends its raw host root once through the common importer. The compiler provides a finite tree of static mutation access prefixes, with property maps at every node and `{}` endpoints. Omission means no requests; `{}` requests only the root. Calls contribute receiver routes and property mutations contribute containing routes, independently of poison scopes. [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree) defines the complete compiler contract.

Build the runtime tree during the initial synchronous segment from the original source inputs and staged/admitted categories. Follow only requested own placement keys. Record external scopes at requested prefixes and continue through requested native child data placements; external nodes can have children. Stage external admission for newly registered native objects, without reclassifying existing managed identities. Remove non-external endpoints and prune empty connecting branches. The compiler retains its unchanged tree; build only the resulting runtime branches and records and release all compiler input references before construction returns.

Authority discovery is a finite occurrence walk, separate from identity admission. Every recursive step consumes a compiler-tree edge, so aliases and context cycles require no subtree enumeration, relative-path cache, or cycle-cut mechanism. Preserve explicitly selected distinct locations for duplicate-identity validation. Discovery adds no reflection beyond its requested prefixes and never enumerates an unrequested managed subtree; ordinary import retains its one-per-identity admission walk.

Stop discovery at every original Promise or thenable, even when ordinary import has synchronously delivered or previously settled its logical overlay. Root thenable delivery receives no discovery setup. Reuse category facts without another thenability probe or subscription. Errors and Functions retain their classification precedence. Ordinary import keeps its logical placement reader and normal thenable consumption; discovery reads original placement inputs instead. Mutable resources must be directly accessible, so all tree construction and registration finish before ContextChain construction returns.

Admission, origin, incoming relationships, placement versions, runtime records, and identity bindings commit atomically. Stage an identity-to-location map alongside the import segment. Two distinct selected locations for one exact identity fail with `ExternalLocationConflict` before any registration, preserving existing bindings. A thenable-only or unselected alias creates no claim. A supported discovery reflection failure abandons the same segment; its pending callbacks cannot later admit or publish. The boundary record and its Symbol-valued entry, exact-value validation, and fixed namespace are specified in [external context ordering](external-context-ordering.md#runtime-nodes-and-identity-validation).

## Admission walk

Fresh Cascada inputs and host import reuse the input-preparation transition, including aliases, cycles, pending segments, and complete parent relationships. Their boundaries determine origin and causal failures: Cascada initialization/assignment does not mark data imported, while host data must cross import first. Call inputs follow [common reception](integration.md#immediate-reception-and-continued-use) before a receiver wait or selected processing; already prepared graphs skip repeated initialization. Parent completion is distinct from optional Promise/Error counter initialization.

Each available synchronous segment uses one transactional identity walk. Its admission dispatcher classifies/reuses identities; managed-container preparation handles logical properties and their continuations. External identities stop ordinary data traversal, while finite external-tree discovery remains a separate named-path walk within the same transaction:


1. Recognize native Errors and classify every other newly reached identity from its declarations and defaults.
2. Traverse new managed records, Arrays, and class instances once while preserving aliases and cycles.
3. Stop at external identities, Functions, and Errors.
4. Consume each reached possible Promise at its program position. A synchronous custom outcome continues this segment; only a returned pending chain becomes a Promise-backed placement.
5. Commit admission, origin, incoming relationships, pending Promise versions, and fixed logical versions only after the complete segment validates. A synchronous custom outcome over unchanged imported storage uses the same fixed-overlay mechanism as other final logical values that cannot be written physically.

Each prepared container has one staged/published/discarded delivery authority. Synchronous delivery advances its captured versions within the same identity walk. Successful preparation commits final versions, incoming occurrences, and `placementsInitialized` together, using private copy storage or entries already captured from the source; the authority stores no separate edge buffers. Pending callbacks then use ordinary version publication, including detached settlement. A discarded record performs no later destination discovery or publication and releases its staging references.

Already admitted, retired input restores relationships from maintained forward state, stopping at active descendants without host inspection or resubscription. Cached-root reception activates and transfers to its consumer within one graph transition; it needs no intermediate lease. Longer preparation holds borrowed restored input under an ordinary preparation lease until success or failure. At transition completion, ordinary retirement removes any restored region without a surviving holder. This may rebuild and retire relationships on failed input, but fresh admissions, copies, versions, and topology remain private until successful commit. A failed attempt neither undoes earlier publication nor releases another consumer's protection.

The walk inspects only own enumerable string-keyed data properties. It neither invokes accessors nor inspects non-enumerables. A supported enumeration, descriptor, validation, or host-reflection failure returns a contextual language Error for that whole synchronous segment and publishes no fresh state from it; ordinary leases release any temporarily restored cached graph. An existing contextual Error remains data and an internal failure is fatal. A native Error at the root returns its occurrence wrapper. A nested native Error remains physically unchanged while the importer stages its wrapper as that placement's fixed logical version. Separate raw-Error introductions may produce equivalent immutable wrappers. Collection deduplicates by raw cause, source-context identity, and kind; no Error identity map must survive a segment merely to intern wrappers. Existing contextualized Errors propagate by exact reference.

An already admitted identity keeps its category and origin. Completed input preparation is reused without a subtree rescan; classification alone is not proof of preparation. `placementsInitialized` covers available placements and their later delivery obligations, independently of Promise/Error counters. Preserve borrowed source captures and attach actual incoming relationships at publication. Import builds no refcount index.

Method-result admission additionally checks traversable result occurrences for
registered mutable capabilities. A call inside mutable external state also
rejects its exact native receiver. These checks reuse the admission walk and
logical placements without reclassifying admitted sources or scanning opaque
interiors. Capture key candidates before inspecting individual descriptors, so a failing descriptor cannot hide later siblings. A failed ready result segment preserves all discoverable ready Errors alongside its capability or reflection failure. Newly owned deferred segments retain that result policy.

Borrowed pending placements also apply the result policy, through copies of their containers and the borrowed ancestors that reach them. Reuse the staged placement walk to preserve aliases and ready cycles; unchanged branches stay shared. Existing managed availability keeps its original settlement and attribution. A result continuation consumes the captured source version after its normal settlement, then validates and publishes only into the result copy. A previously unconsumed Chain placement first establishes its ordinary source settlement. Neither result validation nor later source replacement rewrites that captured version. Copy admission and result versions commit with the result segment; abandoned result work leaves source settlement intact. Nested result availability does not extend the completed receiver phase.

The host-result ownership contract
forbids later receiver access or exposure through nested result work.

Observation-only external property results use an external root admission rule:
a newly reached object stays exact and external, while existing admission is
unchanged. Mutable external property sources instead use the dedicated snapshot
transaction, which admits only successful output copies. Availability handling
must not admit such a source before the snapshot selects its logical read rule.

Public `import(value, operationContext)` creates no static external mutation tree. An unregistered external identity remains observation-only; an already registered identity keeps its binding and access restrictions through every alias. Import cannot downgrade it to freely observable data. Only initial ContextChain import may establish mutation authority.

Result capture shares ordinary managed ownership and captured-version primitives with lookup, not the public lookup operation or its path/operation owner. Retain managed identities through the same sharing rules and read admitted sources through logical placements without reattributing their existing Errors. Fresh host segments retain transactional admission. Result-specific capability validation may differ from the source, including after pending delivery; use selective container/ancestor copies only for that difference. Do not replace this with a full-result await, unconditional graph copy, repeated path lookups, or a policy view that every graph consumer must carry. Receiver rollback and independent result validation have separate effects and completion lifetimes.

## Promise boundaries

A custom root thenable consumed synchronously returns the ready imported root directly. If used as a ContextChain root it grants no external mutation authority: the original root was not directly accessible, even though ordinary import completed synchronously. An actually pending root returns one operation Promise. Its causal completion finishes the same import before exposing the value or ordinary contextual Error. Raw rejection receives the import source and kind; an existing contextualized Error is preserved. A supplied PoisonedValue delivers its ordinary Error through the supported rejection callback and is never admitted as graph data.

A nested pending Promise belongs to its captured property version. Its fulfillment imports newly exposed data before publishing the logical value, while rejection publishes a contextual language Error attributed to this import boundary. Imported physical storage keeps the original Promise; the Promise version stores its logical settlement without writeback. A custom thenable that delivers synchronously is already final for this segment: runtime-owned storage may receive its final value directly, while unchanged imported storage or refused optional synchronization uses a fixed logical overlay rather than a Promise version. Runtime-owned pending Promise properties may synchronize physical storage too; a refused write or its preflight leaves the settled logical value intact. Required import and index processing retain their normal failure rules.

Import owns the processor for each newly available segment. Synchronous delivery joins the active staged walk; later delivery for a committed placement starts a new segment at its existing FIFO position and cannot add external-tree leaves. The importer registers its own delivery transition and publishes the complete prepared placement, including presence and recovery, through the ordinary property-version commit. Property-version code owns capture, version construction, producer tracking, and committed overlay/bookkeeping. Raw reception invokes shared preparation before those commits; import-specific validation remains at the inbound boundary. Record pending publication only after subscription returns, preserving any newer producer established by synchronous delivery; completed publication releases obsolete dependencies. The same staged version becomes the pending Promise version when needed; no installer callback, `ImportTransaction` class, second overlay store, or configurable walker is required.

Borrowed source delivery uses the shared placement resolver to preserve its complete logical state. Initial raw-input subscription and segment validation remain import-owned: ordinary value consumption admits immediately and cannot substitute for staged admission. An abandoned segment stops before result processing. A borrowed transition projects publication onto the result's own version so copies and repair continue through result validation; forwarding the unchecked source transition would grant the wrong authority.

## Ownership

New imported managed identities carry imported protection, so mutation copies before changing host storage independently of parent counts or temporary leases. Copies are runtime-owned; reused imported children keep their origin. Frozen, sealed, and writable imported managed objects therefore have the same logical behavior.

Application code must not mutate managed data after passing it to Cascada. External identities remain exact leaves. Initial context discovery reuses one segment-local identity-to-location map to detect duplicate locations and commit registrations after validation. Binding state follows [external-context-ordering.md](external-context-ordering.md#identity-binding-map). A regular Chain's inert admission cannot disqualify a later context, and an abandoned segment cannot invalidate an existing binding.

## Modules

- `src/import.js` owns the public boundary and direct-Promise completion.
- `src/input-preparations.js` owns shared received-value preparation and the staged processor reused for imported and ordinary input delivery.
- `src/parent-placements.js` owns incoming occurrences and construction publication; `src/array-view.js` owns backing expansion.
- `src/meta.js` owns declarations, admitted facts, and origin metadata.
- `src/property-versions.js` owns placement overlays, fixed logical versions, and the atomic commit used by the import-owned delivery transition.

## Ownership across external boundaries

Mutation paths select external authority without changing managed admission or ownership. Managed aliases and cycles retain their ordinary import semantics, even across those paths; new imported managed identities retain imported protection. Paths containing no directly accessible external boundary add no tree node. Import creates no separate capture selector or per-scope ownership map.

Retaining a managed reference grants native code no permission to inspect or mutate its raw storage. Returning an inert reference remains supported through logical result import and its existing borrowed-version isolation. Native writable state stays within its declared external owner; an explicitly external record may own plain state together with native services. Property observations from mutable external state provide detached managed snapshots. Host-method results instead follow ordinary import, so the host must return independent data or relinquish mutation of the returned managed graph. See the [ownership boundary](external-context-ordering.md#managed-and-external-ownership).
