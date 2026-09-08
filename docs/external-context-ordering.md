# External Context Ordering Architecture

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines the ordering and authority architecture behind them.

The authority policy below incorporates the agreed context/regular-Chain distinction: invalid off-path access fails locally, while competing independent context registrations invalidate shared authority. No earlier placement or completed output is rewritten. Distinct candidate paths to the same external identity within one root context are forbidden and fail import before registration commits.

## Model

External values are exact host identities and are observation-only by default. Cascada may mutate an identity only when its boundary was synchronously reachable from a compiler-provided scope or property mutation path during initial import and every actual use follows one normalized path of one context Chain. Import, storage, copying, and return are not uses.

Managed state uses COW, leases, and transition gates. Mutation-eligible external state uses one readers-writer phase per exact identity. External mutation changes that identity in place. A direct operation Promise retains the phase through boundary completion; a nested result Promise does not.

An external boundary is a context root or the first external identity reached from managed state. It guards the host suffix below that identity for one operation. Cascada never scans an external graph or compares its hidden descendants for aliases.

## Static external mutation tree

Constructing a root `ContextChain` imports its raw host value. `ContextChain` carries its external mutation tree without adding a separate walker or invocation path. The compiler supplies two String/Number path Arrays:

- `scopeMutationPaths` contains each prefix before `!`;
- `propertyMutationPaths` contains each complete assignment or deletion target.

After Promise-valued path support, a mutation path containing a dynamic segment contributes its longest preceding String/Number prefix as a conservative scope path. Thus `apis[pendingKey]!.run()` contributes `["apis"]`, and `[pendingKey]!.run()` contributes `[]`; dynamic assignment and deletion use the same rule. The discovery Arrays themselves remain synchronous and contain no Promise.

Two empty Arrays import the context but build no external mutation tree. Ordinary `Chain` construction admits existing Cascada data without importing it. Both classes use the same importer and execution representation.

Property discovery starts at the context root. For `propertyMutationPaths: [["status"]]`, the empty containing path therefore records the root when the root is external. An empty property mutation path is different: it replaces the Chain's root value and has no containing graph placement, so it discovers nothing. An empty scope mutation path searches the root scope.

During the initial synchronous root import, follow only those paths. A property mutation path follows only its containing path and never inspects the old target. A scope mutation path follows the complete scope and, if still in managed state, searches its selected subtree. Reaching an external identity while following either path records that first boundary and stops the opaque suffix. Consume ready custom thenables through the import transition and stop discovery only at actually pending Promises, Errors, Functions, and external identities. Cut recursion-stack backedges and reuse completed relative discoveries for acyclic aliases, preserving their distinct finite occurrences. Merge duplicate and overlapping discoveries of the same normalized boundary location. If one exact external identity is discovered at two distinct normalized locations, fail the import with `ExternalLocationConflict`; retain nothing for a path with no external boundary.

Import and tree construction form one transaction for each synchronous segment. Discovery reads staged logical placements and admission facts together, including fixed overlays for synchronous custom outcomes; it never rereads a physical thenable as the logical value, resubscribes, or requires early commit. A supported boundary or host-reflection failure returns a language Error and commits none of the segment's admission, origin, sharing, versions, leaves, or new identity entries. Pending subscriptions from a failed segment lose all authority to admit or publish on later delivery. An existing Error remains data; an internal failure is fatal. Synchronous custom delivery continues the same segment; later delivery for a committed placement is a separate segment and cannot add tree leaves.

The compiler paths are discovery inputs, not the tree leaves. The tree stores each discovered first external boundary at its complete normalized context path. The leaf itself is the location: it is unique to that root ContextChain and path and remains the same through entered contextual Chains. Each leaf refers to the execution entry keyed by its exact external identity. The otherwise-valid initial import commits its context registration to that entry atomically with the tree. A competing registration from an independent root ContextChain invalidates their shared authority; a regular Chain never registers a competing claim. A valid root context has at most one discovered location per exact external identity. An external identity absent from every tree is observation-only.

The tree is a fixed positive index, not a copy of the managed graph:

- Promise fulfillment and later graph changes add no leaf.
- It stores no managed alias or cycle topology.
- It is not updated after COW, Array remapping, assignment, deletion, or `enter`.
- Ordinary managed assignment creates another owner. Later mutation through either managed placement uses COW and cannot change the other placement or its live leaves.
- External identities remain exact through a managed copy. Access through another unregistered path or regular Chain fails locally without invalidating the registered context. Competing independent context registrations invalidate the shared binding instead.
- A controlled graph replacement, deletion, or Array remap that would remove, replace, hide, or relocate a live leaf returns a language Error before publication. Array changes that preserve every live leaf's exact path and identity remain valid. Apply the same check to a managed host method's private completed receiver: failure is recoverable `InvalidManagedReceiver`; discard the private receiver, preserve the original managed state, and return the Error. Any recoverable managed mutation failure whose ordinary Error publication would remove a live leaf uses the same preserve-and-return rule. A failed external operation below a managed gate likewise republishes the unchanged managed prefix and carries its failure through the selected external phases. Host behavior is fatal only if it has already changed external state without authority or made another runtime invariant untrustworthy.

A live authoritative leaf is a recorded leaf whose shared binding remains valid for its registered context and path. Derive that fact from the identity entry whenever selecting authority. Invalid leaves may remain in the fixed tree as inert discovery facts; there is no conflict-driven deletion, reverse leaf index, or cleanup scan. Broad scopes select their remaining live leaves only, while an explicit attempt to access the conflicted identity returns its binding Error. Earlier issued operations keep their captured phases and values; a deferred host-access transition validates current authority before starting host work.

Every context-path call or property operation, including an unmarked observation, queries the tree with its complete receiver or target path. The tree finds an exact boundary or the first boundary prefix; any suffix below that external identity is opaque host state and is not stored in the tree. When traversal reaches the boundary, its identity must map back to the leaf's entry; a mismatch is a violated fixed binding. Mutation additionally queries the live descendants of its selected scope. External code may mutate only the boundaries actually selected for that operation; a removed or otherwise unselected identity is outside its authority.

## Identity binding map

One execution-scoped `WeakMap` accounts for every external identity registered in a static tree, including later references to it from regular Chains. The entry owns two semantic facts:

- `binding`: the context registration and its single-location authority, or an immutable `ExternalLocationConflict` Error once incompatible independent contexts have registered;
- `phase`: the readers-writer cursor whose non-thenable completion record carries repairable operation poison.

Do not retain a separate permanent-use history, conflict Boolean, cached current-poison field, reverse placement list, or execution-wide observation registry. Ordinary storage/admission on a regular Chain is not a registration and cannot disqualify a later legitimate context. Error creation uses the importing context that discovers the incompatible registration; selection of that diagnostic source may depend on import timing as documented in `data-limitations.md`.

Context registration is part of the otherwise-valid synchronous import commit. Stage every proposed registration until the complete segment validates; an abandoned import changes no existing binding. A successfully committed competing registration invalidates the shared authority for both contexts. The context objects themselves may remain successfully imported with an unusable capability: neither graph root is retrospectively replaced with Error data and an earlier import result is never revoked. Registration failure is stored in the shared binding, not in repairable phase poison. No asynchronous import-order arbitration or permanent first-arrival winner is introduced.

| Reached state | External operation outcome |
| --- | --- |
| No context registration | Ordinary observation-only external behavior; no mutation authority |
| Valid binding, correct registered context location | Use the ordinary selected external phase |
| Valid binding, regular Chain or another unregistered location | Return an operation-local Error before host access; preserve the context binding and its phase poison |
| Invalid binding from competing context registrations | Return the shared binding Error from access through either context; perform no new host access |

Import, storage, managed assignment, copying, and return create no external-use permission. A direct lookup that would expose a mutation-capable identity fails locally. Through its valid contextual location it still uses the ordinary observation phase so it cannot overtake earlier mutation or miss predecessor poison; export rejects the capability without acquiring authority. A regular Chain cannot turn an observational mode into permission to inspect a registered mutation-capable identity elsewhere.

One `ExternalOperationContext` owns the identity-keyed selection map and operation-wide repair intent. Merge compatible selections and retain their strongest access mode; validate the complete exact selection before any host access so no iteration grants partial authority. Invalid selection returns the ordinary operation Error. Any provisional phase reserved for an unselected or unauthorized boundary completes in predecessor order with unchanged predecessor state; it contributes no new poison to the legitimate context. Access-time validation never commits a new cross-context conflict or grants authority.

Already-invoked external code cannot be interrupted by later registration. Its established boundary processing and rejection ownership still finish normally; ordinary output validation applies, and later runtime accesses consult current authority. Completed results and exact references already delivered to external code cannot be recalled. Such off-path use of an identity intended for contextual mutation violates the host contract even when its future registration was not yet knowable.

Ordinary repair clears operation poison only. It does not clear invalid authority, choose a winner, withdraw a registration, or transfer a binding. Different executions do not coordinate registrations; sharing one mutable resource across them remains unsupported.

## External phases

Use one common readers-writer phase primitive:

```text
observation:
  wait for the latest exclusive operation
  join the current read group

mutation or repair:
  wait for the current read group or latest exclusive operation
  become the new exclusive operation
  close the current read group
```

Register every synchronously selectable receiver and mutation-scope leaf when the operation is issued and before its first wait. Merge duplicate selections by identity; exclusive access wins. Publish all successors before waiting on any predecessor, and never make entries created by one operation wait on one another.

For a Promise-valued path segment, an external boundary already reached by the ready prefix is exact and uses its ordinary access mode. Other live leaves that the unresolved suffix may reach receive exclusive provisional phases, even for an observation. They grant no authority until resolution selects and validates an exact registered leaf. Keep this conservative reservation through selection without adding another queue; it orders possible external work and does not implement a first-use claim.

After phase publication, synchronously capture ready managed property versions, any ready external boundary, and selected input export. Phase predecessors and ordinary readiness may then settle concurrently. Host reflection begins only after both complete. Freeze the phase set before the first wait; an identity first revealed later never acquires another phase.

`run` protects raw managed arguments itself after dispatch. Synchronous issuance is sufficient: the producing lookup has captured and shared its logical result before the consuming `run`, and selected preparation uses ordinary COW, leases, and property versions. Host-input export rejects mutation-capable external identities, so arguments need no lookup provenance or external phase.

An identity with no context registration needs no external phase for ordinary observation. An identity with an invalid shared binding returns its Error before host access; it must never be reinterpreted as freely observable merely because no leaf is currently authoritative. Exact external identities use phases, not managed leases or transition gates; a managed prefix may independently require its ordinary lease or gate.

## Mutation scopes

`!` selects a mutation scope. If the scope is external, select that exact boundary and clamp any deeper host suffix to it. If the scope is managed, use the ordinary managed transition at that prefix and select live external leaves below it only when an external host operation declares that broader scope. A managed method never receives authority over its opaque external descendants.

For example, with managed `apis` containing external `db` and `cache`:

- `apis.db!.write()` selects `db`.
- `apis!.db.refresh()` uses managed mutation handling for `apis` and may select the live external leaves under `apis` for the declared external host effect.
- If `apis` itself is external, both forms select only `apis`; its suffix is opaque.

External code may mutate only the selected authoritative boundaries. Hidden sharing with another external root or an invalid/unselected binding is a host-contract violation. A broad scope selects its remaining live leaves without mutating the static tree; external code must not touch an excluded identity. Explicit access to that identity still returns the shared binding Error.

## Entered branches

A mutating entry's ordinary branch gate prevents outside operations from reaching the entered branch until publication. Operations on the private Chain may therefore run at any time behind that gate and select ordinary external phases only to order themselves. A read-only entry cannot mutate, and the containing Cascada runtime preserves its command ordering.

`enter` always creates an ordinary `Chain`. When its path reaches the source external mutation tree, the entered Chain carries that node as `_externalMutationTree`. The internal `ExternalMutationTree` owns all branch and boundary queries, so root and entered contexts use the same tree operation surface. Nested entry walks from that node; entry below an external leaf remains clamped to the leaf. The entered Chain inherits the source execution without retaining a semantic parent or copying a subtree. Mutating `enter` may publish only state that preserves every live external leaf at its original identity and path.

## Poison and repair

Each phase retains one completion Promise whose fulfillment carries the hook-free state record. Consumers subscribe through the common helper, preserving FIFO delivery even across settlement; there is no alternate direct-record path or phase-membership probe that bypasses queued phase work. Native completion Promises can leave the consuming operation pending even when the predecessor has settled. If an existing supported sync-first completion primitive is used, direct delivery must come from that primitive's own FIFO contract. Do not add a separate ready shortcut, queued-work tracker, or second subscriber queue to external coordination.

External poison belongs to the identity's execution-scoped phase state, not to application data, graph metadata, or the external object. Poisoning never replaces the selected placement with an Error. Existing poison contributes an Error at the selecting receiver; required preparation finishes, external code is skipped, and the poison remains.

Each phase completion fulfills with a hook-free, non-thenable record equivalent to `{ poison }`; the record owns the phase outcome independently of application graph values. The completion cannot reject and needs no rejection-only observer; potentially rejecting derived reactions retain ordinary rejection ownership. Fatal Error is never repairable phase poison and creates no special phase record. A successor that resumes after fatal stops at its common execution check before host work; one whose predecessor never settles may remain pending because every pending operation result observes fatal independently. Every observation after one exclusive predecessor consumes exactly that predecessor's poison, regardless of when peer observations settle. A read group collects every containment failure for combination by the next exclusive successor, with unspecified Error order and no ordered slots solely for Errors; no observation consumes peer-produced poison, including an observation issued after a peer completed. The exclusive successor waits for the group and receives its final combined poison. Ordinary observation failure remains operation-local. A failed or rejected mutation publishes its combined Error through every selected mutation-phase record. An external-containment violation contributes its Error to the observation result and to the selected boundary's next exclusive predecessor state.

Repair-only enters an existing selected location exclusively, bypasses and clears repairable predecessor poison, performs no host access, and returns `undefined`. Repair-and-call bypasses old poison, invokes one selected method, then completes cleanly on success or publishes its new mutation Error. These are the only repair forms. Repair never changes a context registration, clears a binding conflict, creates a tree leaf, or transfers authority.

Assignment replaces, and deletion removes, an Error at the final managed graph placement through ordinary placement transitions. Neither operation implicitly repairs external phase poison; a property operation inside a poisoned external boundary remains blocked until repair-only clears it.

## Host boundary

External property access and calls operate on exact host state. Observation-only property reads and call results use ordinary import. A property read inside mutable external state uses a dedicated synchronous snapshot walk with the same visible copy semantics as export. It may share low-level container creation, enumerable-key reading, and safe property-definition helpers, but it does not invoke or parameterize export. A direct property-result Promise completes before copying; the copy walk rejects nested Promises. Every explicit argument and property-write value is exported. A native setter completes synchronously.

Public `import(value, operationContext)` never creates a static tree or external mutation authority. External identities admitted through it remain observation-only even when the imported value is later used as a Chain root. Only initial `ContextChain` import can establish possible authority.

An external operation follows the common lifecycle:

1. Validate operation inputs and perform ready hook-free internal dispatch.
2. Query the static tree for the receiver and mutation scope, register every possible phase successor, and freeze the set before waiting.
3. Capture graph versions, the ready external boundary, and input export.
4. Wait only as needed for phase predecessors and path resolution, then validate the complete exact selection against current shared bindings before any host access.
5. Finish required preparation. A later preparation failure does not undo the use claim.
6. If preparation or conflict failed, perform no host reflection; otherwise traverse the host suffix and invoke the selected callable exactly once.
7. Import the result, publish mutation poison or repair, complete any managed scope, and fulfill phases with non-thenable state records.

A locally closed continuation in a live execution completes shared settlement but performs no later host access or publication. A continuation in a fatally failed execution returns at the execution check before settlement. External code must not synchronously re-enter the same execution; a separate execution remains independent. Independent work in the original execution may start after the synchronous host call returns with its own explicit operation context, but a direct host Promise must not depend on work ordered behind the call's active managed gate or external phase; such a dependency cycle is invalid host behavior. External identities reached below a selected boundary gain no tree leaf or independent mutation authority. A property read inside mutable external state returns a detached managed snapshot; observation-only external-property results and call results use ordinary import.

## Scope

External ordering adds one static external mutation tree per ContextChain with non-empty scope or property mutation paths and one identity binding-and-phase map per execution. It reuses import, export, invocation, readers-writer phases, operation lifetime, managed COW, leases, gates, versions, and publication.

## Context and regular Chain import order

The following import-order and lazy-rejection policy is agreed and required by the binding model above. Error-output nondeterminism is bounded by [data-limitations.md](data-limitations.md#allowed-nondeterminism-in-error-handling).

### Binding and access distinctions

- Only a context's discovered mutation locations can claim external mutation authority. A regular Chain retaining the same exact identity creates no competing context registration and must not invalidate the context binding, regardless of import order.
- Actual external use still requires one context path. A regular Chain's observational mode does not authorize off-path observation of an identity registered for mutation elsewhere. Its invalid access fails locally through the ordinary Error result; it grants no authority and contributes no new poison to the context's external phase.
- Competing context bindings to one identity cannot choose a permanent winner by import arrival order: independent context imports have no guaranteed invocation order. Once such a conflict is known, both bindings must be unusable. This may be recorded once in their shared execution identity entry; neither context object needs to be rewritten solely for future access checks.
- The relative path of an entered contextual Chain retains the original location. It is not another independent context registration.
- A failed/abandoned import segment must not invalidate an existing binding. Any accepted conflict-registration transition belongs to the same atomic commit as the otherwise-valid incoming discovery, not to speculative traversal.

### Both import orders

| Sequence | Consequence |
| --- | --- |
| Context registration, then regular storage or import | Storage alone creates no competing authority; an attempted off-path external use returns its local Error. |
| Regular storage, then context registration, before any use | The stored identity remains inert. Later use through the regular Chain fails locally; the context remains valid. Admission alone is therefore not sufficient evidence for rejecting the context registration. |
| A regular operation waits, then the context registers, before external access | Its existing external-access check consults current identity authority when it resumes and rejects the off-path use before host access. No reverse placement index is needed for this check. |
| Regular external use or exposure completes before any context registration exists | The runtime could not know the future authority declaration. Later registration cannot reject the completed result, retract an exact reference sent to external code, or undo an earlier host effect. Using a resource intended for contextual mutation outside that context already violates the single-location host contract; detecting that misuse need not be retrospective. |
| Two independent context registrations | Their shared authority can become invalid once both are known. Earlier completed work remains completed; this is an invalid-input detection race, not a deterministic successful execution. |

Merely retaining an external identity in a regular Chain and actively exposing or inspecting it are different cases. Do not add an exposure registry, eagerly poison every previously retained placement, or reject every already-admitted identity solely to handle inert aliases.

### Why silent placement replacement is not equivalent

A binding entry is already shared by external access checks. It can make subsequent uses fail without finding every occurrence. A regular Chain's off-path failure is instead derived from the selected identity and location at that operation boundary. Neither mechanism claims that an idle placement has become stored Error data discoverable by every Error query.

Physically or logically replacing all earlier placements would require locating them and respecting COW, detached property versions, captures, and retained outputs. It still cannot change an exact host reference that already escaped. Similarly, replacing a context placement would not retract earlier host calls. Do not add such a publication mechanism merely to simulate retrospective rejection.

Use local rejection at future off-path access plus shared invalid authority for competing contexts. An idle observational placement does not become stored poison, and Error queries do not gain a reverse alias walk to find such hypothetical poison. Already-running host calls and already-exposed results cannot be recalled. Stronger prevention would require earlier declaration of mutation intent or coordination before exposure, neither of which is part of this architecture.

### Duplicate candidate paths within one context

Initial context import rejects discovery of one exact external identity at two distinct normalized boundary paths with an import-attributed `ExternalLocationConflict`. This includes candidates found through conservative dynamic scopes and distinct acyclic aliases of managed containers, even if later operations would use only one candidate. For example, a scope containing `{ a: resource, b: resource }` is invalid when `resource` is external and both paths are discovered. COW of the managed container does not duplicate that external identity. Duplicate or overlapping compiler requests that reach the same normalized boundary location merge, including equivalent Number/String segments and different opaque suffixes below one boundary. Entered contextual Chains retain the original location and create no new registration.

Validate uniqueness in the existing staged discovery, using its import-local identity-to-location proposals. A second distinct location fails the complete initial segment before any admission, overlay, tree, or registration commits; pending callbacks from that abandoned segment cannot publish later. Existing bindings remain unchanged even if the rejected import also proposed a competing independent-context registration. Only otherwise-valid independent context imports can invalidate shared authority. The committed binding needs one location, with no candidate set, first-use selection, or path arbitration.

Discovery remains bounded to compiler-selected paths and scopes during the initial synchronous segment. Inert aliases outside that discovery do not fail import; future off-path access fails locally. Actually pending values stop discovery and later delivery adds no leaf. Synchronous custom deliveries participate through their staged logical values.

Verification must cover duplicate-path rejection and rollback, permute context/context and context/regular import order, distinguish inert storage from pending and completed access, include already-exposed exact references, and preserve normal FIFO ordering and immutable results for supported single-location programs. No test should expect retroactive failure of a settled result.
