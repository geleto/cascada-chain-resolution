# `enter` Path Ownership

## Status

Entry uses hierarchical external reservations and ordinary managed publication and ownership mechanisms. Entry is an access reservation, not a mutation or a `!` poison scope.

Entry serves Cascada function arguments passed by reference and delayed control flow. It may select a mixed managed/external branch. A mutating entry at `a.x` prevents conflicting outside access there while its callback decides what to issue; `a.y` remains available. Every contained operation independently obeys managed/external mutation scope restrictions. Holding a mixed entry cannot make `apis!.db.write()` valid when `apis` is managed and its canonical route covers registered mutable external locations. Inert aliases elsewhere do not forbid controlled managed writes and grant no external authority.

For a directly selectable managed placement, imported/shared/leased ancestors and representation changes do not justify broader protection. Keep unrelated sibling reads and mutations progressing while entry is open, including repeated no-op and nested entries. Preserve topology and earlier-owner isolation without substituting a gate on the topmost protected container or the whole Chain. Enclosing protection required by unavailable path data, intrinsic structure, or registered native coverage retains its own scope rules.

## API and lifecycle

```js
return enter(chain, path, operationContext, entryMutable, entered => {
    // Issue operations relative to the entered Chain.
    return result;
}, firstDynamicSegment);
```

The result is the callback's value or Promise after required predecessor readiness. Entered Chains use the ordinary data holder, execution binding, and operation APIs; entry sets a readonly capability where applicable and closes new issuance when callback completion is known. The original external-tree node and static path provenance are retained without a copied registration tree or independent context. A reservation-view reference records the entry's covered external access, not additional mutation authority or a public resolver.

The callback may be asynchronous. A ready value, ordinary poison value, or admitted callback-Promise poison rejection completes entry normally. Unexpected synchronous callback throws and raw internal rejections follow the existing fatal-on-escape contract. Do not invent entry abort, fatal cleanup, cancellation, or a second result representation. Required operation contexts, execution binding, and closed-entry issuance retain their common checks.

Entry captures the narrowest directly selectable managed placement or statically selected registered external scope. Unavailable, missing, primitive, poisoned, intrinsic, or unreadable suffixes remain a relative path on that reference. Its protection anchor stays fixed. Resolve preceding placement transitions and external predecessors before callback activation, but do not await ordinary pending data just to select an unused suffix. Supported inspection failure stops optional discovery without creating poison; contained commands consume and validate their destinations at their own operation contexts. Entry at poison retains the original Error and recovery for contained inspection, replacement, or repair. Unused suffixes create no new Error and cannot suppress conditional work.

Closing prohibits new calls through the entered Chain, including after a callback Promise settles. It does not discard state needed by already-issued commands or close nested entries still independently active. Native callbacks use the normal export boundary; direct access to private managed state is not a supported reference-argument shortcut.

Publish completed placement state synchronously when the callback finishes. A ready value needs no leftover gate or extra microtask; a published pending value keeps its ordinary availability. The gate's captured readers follow that logical version, including normalized poison on rejection. Publication and value availability do not impose the same completion lifetime.

Rebasing preserves the logical destination's property key and root/property semantics. Assigning a callable value to `then` fails at the contained assignment's operation context, including through nested empty-path references. If that input is pending, required validation retains the command's scope, ordering, and rollback baseline until it finishes. An ordinary assigned Error or rejection remains data and does not gain recovery merely because validation awaited it. Callback closure does not end an already-issued command's required publication.

## Mutating entries

Managed mutating entry installs a Promise-backed logical placement version before subscribing to source transfer or invoking its callback. Installing or completing protection requires no physical gate write. Necessary ancestor COW isolates earlier owners without widening a directly selectable gate; contained mutations retain ordinary COW and receiver preparation. General redundant-copy and alias/cycle identity consolidation is tracked in Phase 9F-D.

Create the private Chain and capture the original target's complete placement state before detaching it: presence, logical value/source version, and any recovery baseline. Install the public gate before subscribing to pending-source transfer. An absent target initializes an absent private root placement, not a present undefined value; ordinary reads still return undefined and ordinary assignment establishes presence. A pending source forks its exact captured Promise version into that root. If ancestor COW leaves the source reachable elsewhere, preserve sharing at the transfer boundary. Callback invocation happens after required owning-path reconstruction, not after all descendants become ready. When deferred selection has captured a source version, take the value, presence, and recovery state from that version even if later work has replaced the live placement.

A gate orders current-owner access. Captured earlier versions keep their ordinary values and Promise frontier. Unrelated object sibling paths do not wait. Entry into an absent property does not itself create that property: publication transfers the private root's final presence as well as its value. A no-op callback preserves absence, while an explicit assignment of undefined creates a present property. Deletion follows the original reference even through nested entries: a property reference removes its placement, while an original Chain-root reference produces null. The private holder does not change those semantics. Use ordinary placement-state transfer, not an entry-specific dirty flag or a remembered initial value used to guess whether work happened. Successful entry setup does not add language poison: a contained mutation publishes its selected scope effect, while a callback's independent Error result need not poison the entered value.

### Structural publication

Array-index entry protects its element, including holes and out-of-range indexes. Protection creates no physical slot and commits no growth. Register a possible index + 1 contribution at issuance, before predecessor waits. A contained creation, including pending data or poison, commits growth immediately while the element gate remains closed; later deletion or repair to absence does not shrink length. Complete no-growth only after required contained transitions and final publication finish, including queued entries inheriting presence. Array methods publish independently owned placements through remaps or derived views. Retained placements carry their captured transitions without delaying publication of the new Array; discarded placements have no write authority over it. Methods wait only for required arguments, shape, or consumed values. Direct length assignment waits for transitions in its truncated suffix before changing live placements. Assignment of length `n` waits only for transitions at indexes at least `n`, including metadata-only indexes beyond physical storage; retained-prefix entries remain independent.

Placement publication commits presence, value, recovery, indexed edges, and structural effects together. Entered private references publish committed creation/deletion through their captured source placement; required storage failure remains a command failure, while protection-only installation/completion writes no placement and does not resize backing storage. Record entry reserves its possible insertion position at issuance. Replacement and no-op preserve the old position; creation or deletion/recreation uses the reserved position, before later sibling creations regardless of completion order. Numeric keys retain numeric order. Captured copies and native receiver preparation use these same logical facts.

Record insertion position travels with the captured placement, including pending-prefix mutation, ordinary queued commands, entry, and borrowed-result copies. A successor consumes the predecessor's committed position rather than sampling a mutable predecessor token. Ordinary payload settlement does not insert the property again. Structural reservations belong to individual transitions and are passed to common publication; several commands may use one publication version without sharing a mutable structural slot. A detached producer still commits the structural effects promised to earlier captures, while losing physical write authority.

Array length readiness is independent of element-gate completion. [Captured shape and pending placements](array-view.md#captured-shape-and-pending-placements) defines ordered length/range questions, capture and copy lifetimes, and consumer readiness.

## Read-only entries

A managed read-only entry leases a ready captured anchor and releases its lease after callback completion. A pending anchor retains its exact source version before transfer; this conservative sharing protects publication even if the callback closes before delivery. No late lease is acquired by a closed entry. Outside managed mutations COW instead of waiting. Escaping lookup results establish permanent sharing. Primitives and observation-only external identities need no managed lease.

A managed parent lease cannot protect mutable external descendants. Every read-only entry reserves observation access to covered external resources, including when its root is a registered external scope. Other observations overlap, while conflicting native mutations wait through the entry's required access lifetime. Readonly capability prevents contained mutation even when an enclosing entry holds exclusive access. Managed read-only roots additionally keep their ordinary lease; unregistered observation-only external identities need no reservation.

## Mixed and external entries

An entry target may be managed, mixed, or a registered external scope. Mixed entry is intentionally less restrictive than a managed bang mutation scope. Its managed gate/lease protects managed access, and one subtree reservation protects the covered native state. Both use the entry's captured source turn, not a new operation queue.

Registered external entry stores no gate in native properties or in a separate contextual-binding Promise. The common external-tree reservation protects its selected subtree. The private Chain holds the exact registered native identity; contained operations cannot replace fixed identities, move registered descendants, bypass poison/binding checks, or gain authority from entry.

Pass the original requested path and firstDynamicSegment to enter. Runtime capture selects the deepest usable static registered scope for a native suffix, retains that suffix, and performs no native leaf reflection. A registered child can be entered independently. Original dynamic provenance survives rebasing; actual commands reject dynamic registered-resource selection while ordinary managed and unregistered native suffix keys remain supported.

## Reservation ownership

[External ordering](external-context-ordering.md#external-phases) owns the single direct/subtree frontier algorithm. Reserve the entry's statically selected subtree in its issuing view at issuance, before managed target selection can wait. Capture the managed placement through ordinary FIFO/version ordering without first awaiting external predecessors. The callback requires both selections. An entry creates a covered view in which contained commands use that same algorithm. Outside commands remain in the parent view, where they encounter the entry's reservation. A nested entry creates a nested view under a reservation in its parent's view. Share immutable tree locations and identity binding facts; view-local frontiers are temporary entry ordering state and are released with that view. Widening a managed gate to protect Array structure does not enlarge the exposed entry's native coverage.

For external coverage, reserve at issuance and wait for captured predecessors before invoking the callback. An empty predecessor set adds no Promise turn. Stored poison and binding conflicts remain checks on actual contained access; unused references do not skip callbacks or create poison. The private reservation view cannot bypass outer prerequisites.

This prevents a deadlock such as: child entry A is active; later ancestor entry B waits for A; A issues another contained operation. A's operation uses A's view and cannot queue behind B. It still waits for earlier contained work and cannot exceed its entry's scope or readonly capability. Do not solve this by granting A ownership of B's gate, following a graph of later dependent gates, or cancelling B.

A mutating entry reserves its native subtree exclusively; a read-only entry reserves observation access. Each contained command with selected external coverage acquires its one reservation and lifetime membership at issuance, including when managed gates delay its route. Selection failure publishes its managed effect without acquiring a wider reservation. Completion still waits for captured external predecessors so later conflicts cannot bypass them. At callback closure stop issuance and capture outstanding completions, including already-issued nested entries, before releasing outer coverage. Remove completed membership promptly and do not retain independent nested method-result Promises.

Managed and external completion must remain separate. A parent managed entry may publish its private graph while a native child remains reserved, so a ready managed sibling is usable immediately. Its native paths still observe the live tree reservations. A contained managed child gate remains in the published graph and preserves its own path availability. Do not hold the entire managed parent gate until every child effect finishes, and do not release external reservation coverage at callback closure while child effects remain.

## Promise frontiers

### Pending ancestors

An unavailable managed ancestor fixes entry at that ancestor placement and leaves the remaining suffix on the private reference. A no-op callback can finish while the data remains pending. Earlier transition work still determines callback activation; the reference never narrows after delivery. Contained operations resolve the suffix at their ordinary FIFO positions. Statically selected external coverage retains its separate reservation. See the [reservation turn](external-context-ordering.md#routing-and-capture-points) for the Phase 10 handoff for unresolved path keys.

### Promise-valued mutating target

Set up the private root and original version capture, install the public gate, and then fork source availability. Supported synchronous thenables may invoke transfer callbacks immediately, so all state needed by transfer/publication must exist before subscription. The callback can issue operations against its pending private root; entry does not await the source solely to begin issuance.

### Promise-valued read-only target

Read entry can activate with a pending data anchor. Retain the captured version before transfer, or lease a ready managed anchor. A preceding unfinished transition still delays activation. Source attribution, import ownership, and outside COW remain unchanged.

### Pending descendants

Nested Promises do not delay entry setup or ready sibling access. They retain ordinary property versions. Pending managed method receivers are prepared only when that method consumes them. Native snapshots keep their separate ready-only rule.

## Completion and publication

Callback completion closes new issuance first. Managed read-only entry releases its captured lease. Managed mutating entry transfers the latest private root's complete placement state. Publication completes without awaiting ordinary pending data; an unfinished contained transition keeps its own ordering signal in the transferred version. Final replacement/deletion waits for those transitions, while value consumers also wait for the published data. Capture and subscription at callback closure are essential; do not capture the private root's eventual value before its contained commands are issued. Mark detached publication reactions handled at their origin.

The callback result is not a publication signal. A direct result may be available while selected-root publication remains pending. An independent result Promise does not extend an already-completed mutation's lifetime. Conversely, unfinished external effects promised by issued operations retain the outer reservation even if callback completion is ready. These distinct lifetimes do not justify a universal configurable gate helper.

Entered-root publication transfers the complete logical placement state, including presence, any retained rollback baseline, and original source version, through the ordinary property-version mechanism. Resolving a gate with only the visible value or Error would lose absence or recovery state. Capture that state from the same latest private root at closure or deferred publication; nested transfer must not recapture the baseline from an earlier root or restore the entry-start value. Publish absence as absence, and keep an explicit undefined assignment present. Keep the Error unchanged, update any canonical namespace reference only when publishing for its canonical owner, and complete required index bookkeeping in that publication. Failure obeys ordinary publication and scope rules and preserves every required independent result Error. Fatality stops continuation work before publication and is exposed through public pending-result handling; never settle internal gates to simulate fatal cancellation.

Each queued managed mutation owns its publication version. Keep an absent version attached while its mutation takes its synchronous turn, then remove it if it still represents completed absence. A remaining gate keeps the version pending. Captured readers retain their own versions independently; cleanup must neither discard later poison/recovery publication nor accumulate records for completed absent entries.

## Ownership and import attribution

Entry into existing graph data does not reimport it. Transfer preserves category, origin, logical versions, and causal Error attribution. Copying managed ancestors preserves shared children and fixed external bindings. Root and entered Chains use the same operation API; entry adds only readonly/closed capability and its captured location/reservation ownership facts.

Managed rollback and scope poison belong to captured placement state, not shared identity metadata. Each contained managed mutation preserves its own pre-operation value; successful earlier commands remain committed if a later command fails. Entry gates access but creates no callback-wide rollback transaction. A healthy earlier snapshot does not acquire later poison, while native access still obeys canonical namespace poison. Repair reveals the preserved baseline without changing previously returned Errors.

## Composition and lifecycle constraints

Reference arguments to Cascada functions use entry and issue all reference operations through the entered Chain. Native method arguments use export and do not gain reference mutation permission. Compiler delayed-control-flow lowering chooses the smallest correct effect path and calls the public entry-target handoff for external scope boundaries. It never narrows a mixed entry simply because a bang mutation at that mixed root would be invalid.

### Multiple reference arguments

This is the planned Phase 13 extension, not part of the current single-path API or Phase 9F-C. The compiler supplies mutation and observation path lists for reference calls and control flow. Entry is established before evaluating the callback, including a slow condition inside it. For a body that mutates `x.child` and observes `x.other`, both paths participate in one coordinated entry and the body uses the corresponding supplied references. Declaring the observation does not mean performing the application read or evaluating the condition before entry. The lists describe this callback's access requirements; they are separate from the initial context mutation access tree used for external registration.

A reference call is one batch of requested entries. Issue every disjoint selection during the same synchronous turn, without awaiting another argument's selection or external predecessors. Each statically selected external coverage reserves immediately, even when that reference's own managed path is gated or a disjoint managed argument is pending. Managed path capture still takes its FIFO position independently of external waiting. Invoke the callback after its required reference captures and predecessor transitions are ready, without resolving unused data values or suffixes merely for setup. Keep original captures, source provenance, capabilities, and entry lifetimes throughout.

Collapse overlapping routes before acquiring their entries. Work from currently reachable prefixes: an unresolved managed path uses the ordinary selection gate at its longest reached prefix. Arguments within that protected prefix share its private selection work instead of acquiring an entry behind their own batch's gate. After selection resolves, merge equal/ancestor targets and derive relative references from the same entered holder/view; no duplicated mutating roots or overlapping writeback. Preserve each reference's readonly capability and managed lease capture; unifying scheduling must not turn a captured read-only managed value into a live mutable alias. For mixed entry modes, retain their actual observation/mutation coverage: a read-only parent plus mutable child does not justify exclusive access to the entire parent. Start all disjoint reachable selections before returning from the batch's issuance turn, and repeat this capture-before-publish step synchronously when a shared prefix advances. This also preserves priority when two calls list the same references in opposite argument orders. Do not reserve guessed external candidates or widen disjoint references to a common parent.

An earlier outside gate is still a prerequisite, never owned by the batch. A statically selected reference under it captures that managed version and reserves external order during issuance. For f(managedBranch, db) followed by db!.set(2), f already holds db's reservation while managedBranch waits, so f's eventual db write cannot run after set(2). An unresolved path key instead requires Phase 10's prefix protection and selection handoff before later operations can issue; do not claim that lifetime membership alone supplies ordering. References overlapping within the batch share selection, without sequential acquire-and-wait between them. A callback using an unrelated outside Chain does not inherit batch ownership.

Phase 13 implements one public batch-selection handoff over the existing managed path protection, placement transfer, and external capture/publish kernel. Generated code must not implement the batch by nesting single-entry callbacks or by waiting for all selections before reserving ready arguments. No global scheduler, per-resource ticket history, additional reservation kind, or private tree API is required. Verify the partial-readiness and overlap cases before choosing its concrete API; Phase 9F-A keeps the primitives composable without adding a speculative public overload.

The implementation keeps one explicit owner for an issued operation, normal guarded continuations, and separate release points where source lifetimes differ. Entered external views contain only frontier state for their covered subtree. They do not duplicate managed graph publication, maintain pending-operation queues, or add execution-wide cancellation/ownership registries. Remove superseded owned-gate dependency traversal once captured managed placement state and covered entry views preserve the nested-entry behavior. Never substitute a late live-gate scan.

## Path errors and fatal failures

A managed path Error, native scope poison, or binding failure blocks actual contained access with its original Error. Entry setup retains the reference without consuming an unused suffix or suppressing its callback. Contained mutation failure follows its selected/static-prefix poison rule while preserving fixed identities; readonly failure affects only its result. Gate installation grants no native mutation authority on a mixed scope. Contained repair can clear only its selected recoverable state and cannot clear a permanent identity conflict.

Unexpected runtime failures, execution mismatch, and new issuance through a closed entered Chain retain their established fatal boundaries. No special entry rejection action, contextless execution, abort method, or cleanup Promise is added. Detached publication and already-issued native work retain their existing handled-reaction obligations.

## Implementation contracts

Keep managed gate installation and completion at their natural points. Managed mutation gates only returned pending work; entry gates before callback issuance. Share property versions, path COW, and the external reservation kernel, not a helper that hides these different capture moments. Entry setup initializes its private root before a synchronous callback can observe it and completes owning-path writeback before publication can escape.

The data holder of an entered Chain has the same representation as a normal Chain. Its context provenance supplies canonical depth and first-dynamic-segment information; its reservation view supplies inherited external access coverage. Entry uses common route capture, placement transfer, gates, and ExternalEffect reservations; it does not run the mutation scope selector to discover a reference. It retains callback closure and private placement transfer, and completes its external coverage only after the covered view's outstanding effects. Gate resolvers stay private to the entry/publication code. Entry and mutation use the same captured-placement gate completion, which follows the captured source version and delivers value, presence, and recovery together. A read-only or closed capability is checked at common issuance boundaries; helpers do not repeat malformed-internal-control validation.

## Verification

- Enter a.x behind a slow condition and keep a.y immediately available; repeat with shared/imported ancestors and pending source versions.

- Enter an absent record property and absent Array indexes, including in-range holes and out-of-range slots, with a delayed no-op callback. Preserve absence, holes, and length; explicit undefined assignment creates a property. Verify nested entry, failed contained mutation followed by repair, and earlier successful contained commands.
- During an Array-index entry, verify early creation growth while the element stays gated, captured length/range answers, no-op absence, creation followed by deletion, queued same-index contributions, nested completion, and logical growth without physical storage. Fixed-index and bounded observations exclude unrelated waits. Array methods publish independent placements carrying retained transitions; direct length assignment waits for its truncated suffix. Verify progress, late publication, and immutable method results separately.

- Enter an already-poisoned managed target in both modes: inspection runs, mutating repair/replacement restores normal use, and readonly mutation remains forbidden. Cover ordinary Error data without a baseline, strict-ancestor blockers, and pending delivery of target poison. Repeat through nested entry and compiler-style conditional/reference callbacks.
- Enter registered external siblings concurrently; parent entry waits for both. A child continues issuing work while a later parent reservation waits for it, with no deadlock or overtaking.

- Queue an entry behind a pending external mutation and read immediately inside its callback. The callback starts after the predecessor finishes and sees its completed state. Repeat with predecessor failure at the selected scope, strict-ancestor poison, and binding conflict: no-op callbacks still run, and actual contained access preserves the original poison or binding failure. Cover both entry modes, nested views, and ready predecessors.

- Batch references with one pending managed argument and one ready external argument, followed by a later mutation of the external resource. Preserve the call's earlier position. Cover reversed argument order, equal/ancestor/descendant references, a pending key whose selection prefix covers another argument, nested entry views, mixed readonly/mutable references with preserved managed snapshots, and independent siblings.
- Preserve managed ready-sibling access after parent callback closure while native child work remains pending. Preserve open nested managed and external entries after parent publication.
- Cover read-only mixed and external-root entry with observation coverage: concurrent observations proceed, conflicting mutations wait, and nested readonly capability remains enforced.
- Verify runtime selection of the deepest usable registered scope without native leaf reflection, including command-owned computed-prefix rejection and no-op references through poisoned or invalid bindings.
- Keep callback Error completion, independent result Promise lifetime, scope poison, recursive repair, permanent binding conflict, and fatal pending-result delivery distinct.
