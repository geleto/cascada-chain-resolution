# External Context Ordering Architecture

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines the ordering and authority architecture behind them.

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

During the initial synchronous root import, follow only those paths. A property mutation path follows only its containing path and never inspects the old target. A scope mutation path follows the complete scope and, if still in managed state, searches its selected subtree. Reaching an external identity while following either path records that first boundary and stops the opaque suffix. Stop discovery at Promises, Errors, Functions, and external identities. Cut recursion-stack backedges and reuse completed relative discoveries for acyclic aliases, preserving their distinct finite occurrences. Merge duplicate and overlapping results and retain nothing for a path with no external boundary.

Import and tree construction form one transaction for each synchronous segment. A supported boundary or host-reflection failure returns a language Error and commits none of the segment's admission, origin, sharing, mirrors, leaves, or new identity entries. An existing Error remains data; an internal failure is fatal. A later Promise fulfillment is a separate segment and cannot add tree leaves.

The compiler paths are discovery inputs, not the tree leaves. The tree stores each discovered first external boundary at its complete normalized context path. The leaf itself is the location: it is unique to that root ContextChain and path and remains the same through entered contextual Chains. Each leaf refers to the execution entry keyed by its exact external identity. Discovery leaves the entry's actual-use location unset, so several leaves may initially refer to one entry without selecting one. An external identity absent from every tree is observation-only.

The tree is a fixed positive index, not a copy of the managed graph:

- Promise fulfillment and later graph changes add no leaf.
- It stores no managed alias or cycle topology.
- It is not updated after COW, Array remapping, assignment, deletion, or `enter`.
- Ordinary managed assignment creates another owner. Later mutation through either managed placement uses COW and cannot change the other placement or its live leaves.
- External identities remain exact through a managed copy. Actual use through another Chain or path, or through a later alias elsewhere, is handled by the identity map and conflicts.
- A controlled graph replacement, deletion, or Array remap that would remove, replace, hide, or relocate a live leaf returns a language Error before publication. Array changes that preserve every live leaf's exact path and identity remain valid. Apply the same check to a managed host method's private completed receiver: failure is recoverable `InvalidManagedReceiver`; discard the private receiver, preserve the original managed state, and return the Error. Any recoverable managed mutation failure whose ordinary Error publication would remove a live leaf uses the same preserve-and-return rule. A failed external operation below a managed gate likewise republishes the unchanged managed prefix and carries its failure through the selected external phases. Host behavior is fatal only if it has already changed external state without authority or made another runtime invariant untrustworthy.

Tree lookup is the only tree-removal point. A leaf is always checked against the identity map before use. If its identity is already in permanent conflict, remove that leaf and report no live boundary. Other leaves remove themselves if later queried; no reverse identity-to-leaf index or tree scan is needed. Already-issued operations retain their captured identity state.

Every context-path call or property operation, including an unmarked observation, queries the tree with its complete receiver or target path. The tree finds an exact boundary or the first boundary prefix; any suffix below that external identity is opaque host state and is not stored in the tree. When traversal reaches the boundary, its identity must map back to the leaf's entry; a mismatch is a violated fixed binding. Mutation additionally queries the live descendants of its selected scope. Host code may mutate only the boundaries actually selected for that operation; a removed or otherwise unselected identity is outside its authority.

## Identity use map

One execution-scoped `WeakMap` accounts for every external identity recorded in any static tree, including later references to that identity outside the tree. Tree construction creates or reuses one durable entry with exactly two fields:

- `use`: unset before first use, `ONE(location)` for one live tree leaf, or `CONFLICT(reason)` after incompatible use;
- `phase`: the readers-writer cursor whose non-thenable completion record carries the repairable poison state.

Keep only the first stable conflict reason, not operation history. There is no separate durable current-poison field. Conflict belongs to `use` and is permanent; repairable operation poison belongs to phase-state records, including the current read group while it is open. This is execution state, not graph metadata: neither poisoning nor repair replaces a placement or modifies the external object. A tree leaf may refer to the shared entry, but the map never needs to enumerate the leaf set. Different executions do not share authority or ordering.

Actual use means selecting a supported call or property operation through an external boundary, or selecting a boundary as part of a broader external mutation scope. Import, managed assignment, storage, return, and copying do not count. Once ordered, selection claims authority even if member reflection or later preparation fails before host access. A direct lookup of a mutable external identity fails without recording use, but still joins that boundary's observation phase so it cannot overtake earlier mutation or miss predecessor poison. An attempt to export one fails without recording use or acquiring a phase.

Apply actual-use transitions when the complete exact selection and its phase predecessors are ready:

```text
no state + use at a live leaf              -> ONE(that location)
no state + use anywhere else               -> CONFLICT and Error
ONE(location) + use at the same location   -> unchanged
ONE(location) + any other actual use       -> CONFLICT and Error
CONFLICT(reason) + any actual use           -> Error using that reason
```

Mutation additionally requires the current location to be a live tree leaf. An identity absent from every static tree remains observation-only and may be observed from any location; it needs no identity-map entry or phase.

Conflict is permanent. The conflicting operation performs no access through the selected external receiver, publishes poison in operation order when a phase exists, and returns an Error explaining the first incompatible use. Repair may clear an ordinary operation failure but cannot clear conflict or grant another location. A late alias discovered behind a Promise is rejected when reached; it never acquires authority or causes tree growth.

One `ExternalOperationContext` owns one identity-keyed operation map and the operation-wide repair intent. Each selected record contains the location, strongest access mode, use transition, and phase-completion handle. Merging another location for the same identity creates conflict instead of discarding either location. Durable identity entries contain none of those operation facts.

Evaluate the complete actual-use set from one state and commit it atomically at the first ordered point after exact selection. A ready operation does this synchronously; an unresolved path does it in its already-ordered phase continuation. Commit before host access and independently of later preparation success. If any conflict exists, commit every discovered permanent conflict but no compatible new location. Otherwise commit all new locations together. Report conflicts in deterministic receiver and path order; iteration order must not grant partial authority.

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

For a Promise-valued path segment, an external boundary already reached by the ready prefix is exact and uses its ordinary access mode. Other live leaves that the unresolved suffix may reach receive exclusive provisional phases, even for an observation. They record no use until resolution selects an exact leaf; the exclusive reservation prevents later authority decisions from overtaking them without adding another queue.

After phase publication, synchronously capture ready managed property versions, any ready external boundary, and selected input export. Phase predecessors and ordinary readiness may then settle concurrently. Host reflection begins only after both complete. Freeze the phase set before the first wait; an identity first revealed later never acquires another phase.

`run` protects raw managed arguments itself after dispatch. Synchronous issuance is sufficient: the producing lookup has captured and shared its logical result before the consuming `run`, and selected preparation uses ordinary COW, leases, and property versions. Host-input export rejects mutation-capable external identities, so arguments need no lookup provenance or external phase.

An identity with no live tree leaf needs no external phase for ordinary observation. If actual traversal finds it in `CONFLICT`, it returns Error without host access. Exact external identities use phases, not managed leases or transition gates; a managed prefix may independently require its ordinary lease or gate.

## Mutation scopes

`!` selects a mutation scope. If the scope is external, select that exact boundary and clamp any deeper host suffix to it. If the scope is managed, use the ordinary managed transition at that prefix and select live external leaves below it only when an external host operation declares that broader scope. A managed method never receives authority over its opaque external descendants.

For example, with managed `apis` containing external `db` and `cache`:

- `apis.db!.write()` selects `db`.
- `apis!.db.refresh()` uses managed mutation handling for `apis` and may select the live external leaves under `apis` for the declared external host effect.
- If `apis` itself is external, both forms select only `apis`; its suffix is opaque.

Host code may mutate only the selected external boundaries. Hidden sharing with another external root or a removed conflict leaf is a host-contract violation.

Pruning deliberately prevents a conflicting sibling from disabling later broad scopes. Those scopes may use their remaining live leaves, but host code must not touch the pruned identity.

## Entered branches

A mutating entry's ordinary branch gate prevents outside operations from reaching the entered branch until publication. Operations on the private Chain may therefore run at any time behind that gate and select ordinary external phases only to order themselves. A read-only entry cannot mutate, and the containing Cascada runtime preserves its command ordering.

`enter` always creates an ordinary `Chain`. When its path reaches the source external mutation tree, the entered Chain carries that node as `_externalMutationTree`. The internal `ExternalMutationTree` owns all branch and boundary queries, so root and entered contexts use the same tree operation surface. Nested entry walks from that node; entry below an external leaf remains clamped to the leaf. The entered Chain inherits the source execution without retaining a semantic parent or copying a subtree. Mutating `enter` may publish only state that preserves every live external leaf at its original identity and path.

## Poison and repair

External poison belongs to the identity's execution-scoped phase state, not to application data, graph metadata, or the external object. Poisoning never replaces the selected placement with an Error. Existing poison contributes an Error at the selecting receiver; required preparation finishes, host code is skipped, and the poison remains.

Each phase Promise is marked handled at creation and fulfills with a hook-free, non-thenable record equivalent to `{ poison }`; it never fulfills directly with a rejecting-thenable Error. Fatal Error is never repairable phase poison and creates no special phase record. A successor that resumes after fatal stops at its common execution check before host work; one whose predecessor never settles may remain pending because every pending public operation result observes fatal independently. The current read group keeps issuance-ordered outcome slots and the poison known so far. An observation snapshots that known poison when it joins: peers already issued are unaffected, while observations issued after poison is published and the next exclusive operation see it. The completed group exposes the final combined poison in its completion record. Observation failure normally does not poison. A failed or rejected mutation publishes its combined Error through every selected mutation-phase record. An external-containment violation adds its Error to the selected boundary.

Repair-only enters an existing selected location exclusively, bypasses and clears repairable predecessor poison, performs no host access, and returns `undefined`. Repair-and-call bypasses old poison, invokes one selected method, then completes cleanly on success or publishes its new mutation Error. These are the only repair forms. Repair never changes actual-use history, clears `CONFLICT`, creates a tree leaf, or transfers authority.

Assignment replaces, and deletion removes, an Error at the final managed graph placement through ordinary placement transitions. Neither operation implicitly repairs external phase poison; a property operation inside a poisoned external boundary remains blocked until repair-only clears it.

## Host boundary

External property access and calls operate on exact host state. Observation-only property reads and call results use ordinary import. A property read inside mutable external state uses a dedicated synchronous snapshot walk with the same visible copy semantics as export. It may share low-level container creation, enumerable-key reading, and safe property-definition helpers, but it does not invoke or parameterize export. A direct property-result Promise completes before copying; the copy walk rejects nested Promises. Every explicit argument and property-write value is exported. A native setter completes synchronously.

Public `import(value, operationContext)` never creates a static tree or external mutation authority. External identities admitted through it remain observation-only even when the imported value is later used as a Chain root. Only initial `ContextChain` import can establish possible authority.

An external operation follows the common lifecycle:

1. Validate operation inputs and perform ready hook-free internal dispatch.
2. Query the static tree for the receiver and mutation scope, register every possible phase successor, and freeze the set before waiting.
3. Capture graph versions, the ready external boundary, and input export.
4. Wait only as needed for phase predecessors and path resolution, then assemble and atomically commit the exact identity-use batch.
5. Finish required preparation. A later preparation failure does not undo the use claim.
6. If preparation or conflict failed, perform no host reflection; otherwise traverse the host suffix and invoke the selected callable exactly once.
7. Import the result, publish mutation poison or repair, complete any managed scope, and fulfill phases with non-thenable state records.

A locally closed continuation in a live execution completes shared settlement but performs no later host access or publication. A continuation in a fatally failed execution returns at the execution check before settlement. Host code may synchronously issue nested Cascada operations, which use their own explicit operation contexts and ordinary ordering. A direct host Promise must not depend on a nested operation ordered behind the call's active managed gate or external phase; such a dependency cycle is invalid host behavior. External identities reached below a selected boundary gain no tree leaf or independent mutation authority. A property read inside mutable external state returns a detached managed snapshot; observation-only external-property results and call results use ordinary import.

## Scope

External ordering adds one static external mutation tree per ContextChain with non-empty scope or property mutation paths and one identity use-and-phase map per execution. It reuses import, export, invocation, readers-writer phases, operation lifetime, managed COW, leases, gates, mirrors, and publication.
