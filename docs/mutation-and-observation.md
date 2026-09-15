# Mutation and observation architecture

Accepted architecture for property operations, method calls, and entry. The [data contract](data-limitations.md) is authoritative; [Phase 9F-A](first-principles-conformance-plan.md#phase-9f-a-replace-external-scope-coordination) tracks the pending implementation cutover.

## Lease: preserve a value temporarily

A managed lease protects a value that unfinished work still needs. Leases are counted: each reader releases its own lease after its last use. Other readers can continue, and a writer can proceed by copying the protected data.

Use a managed lease for:

- **Arguments awaiting consumption:** while receiver selection or controlled argument processing still needs the original managed values. Release their protection when they have been consumed, copied, or safely retained.
- **Receiver preparation:** while resolving the graph needed by a managed call. For mutation, protection ends when the working receiver is isolated.
- **Managed observations:** while a method or controlled operation can still read its captured receiver, including through its direct Promise.
- **Observation-only managed entry:** while its callback can use the captured value. Lookups through that entry establish lasting sharing when needed.
- **Pending managed path selection:** while an unresolved key prevents capture of the final target, protect the longest reached managed prefix. Reuse that protection across further pending keys.

A lease is unnecessary when the required data has already been captured safely. For example, export copies available data immediately and captures pending property versions; a pending output does not require leasing the entire source. Once arguments are exported, using the independent copies needs no source lease.

**External reads need different enforcement.** Temporarily reading a mutable external resource must prevent later writers from changing that exact identity. Observations reserve access through a read gate: readers can overlap, but the next writer waits. A managed lease would merely make runtime writers copy and cannot protect native state. Read gates apply only to resources with mutable external authority; observation-only external identities remain unlocked under their host contract.

## Mark shared: preserve a retained value

Mark managed data shared when another owner or output may retain it. Later mutation through either owner must preserve the other's logical value. Sharing has no operation-end release.

Use sharing for:

- **Every public lookup returning managed data**, including after Promise resolution: its result may be retained or passed to another Chain.
- **Managed method and operation results** that remain reachable from a receiver or another retained value.
- **Assignment or copying that creates another managed owner**, including children retained by both sides of a copied parent.
- **Imported managed data**, which runtime writes must preserve.

Primitives and immutable Errors need no sharing flag. External identities are not protected by managed sharing. Internal path traversal, temporary reads, and ownership transfers need not create another owner just because they read a value.

When temporary observation becomes retention, establish sharing before releasing the lease. Preserve all relevant aliases through the ordinary ownership rules; a fresh wrapper around an existing child does not make that child independent.

## Copy-on-write: preserve other owners during mutation

Before modifying managed data, copy where sharing or a lease requires preserving the existing value. If no protection or representation requirement calls for a copy, the writer can use its current storage.

Use COW for:

- **Managed assignment, deletion, and mutation**, including rebuilding an affected path through protected parents.
- **Controlled Array mutations**, preserving retained values and logical views.
- **Managed method mutation**, isolating the prepared receiver where required.
- **Work inside a managed mutating entry**, using the same ownership rules.

Copy only the affected managed structure required by the operation. Protect children retained by both versions. Native managed methods additionally need a receiver representation on which ordinary JavaScript writes are safe: those writes do not perform the runtime's COW checks themselves.

COW never substitutes another identity for an explicitly mutated external resource. A managed parent containing an external identity still uses ordinary COW; copying the parent grants no new authority over the external child.

## Gate: order access around unfinished work

A mutation gate blocks later dependent observations and mutations until the required change is complete. An external read gate lets observations overlap while making the next mutation wait for them. Gates protect access and publication order; sharing and leases preserve earlier managed values.

Use gates for:

- **Pending managed assignment or other mutation:** publish the unfinished value through the affected placement's ordinary Promise version.
- **Asynchronous managed method mutation:** keep the working receiver private until its required mutation and publication finish.
- **Mutating entry:** install the gate before invoking its callback and issue contained work through a private Chain.
- **Pending mutation path selection:** gate the longest reached managed prefix while selection remains unfinished.
- **Mutable external observations:** join the current read gate, waiting for the preceding mutation but not for other observations in that group.
- **External mutation and repair:** reserve an exclusive ordering position for the whole external owner before waiting for inputs or performing native work.

A ready ordinary managed mutation needs no new gate. An independent pending result does not justify retaining a gate after its promised state change is complete. A gate on a managed placement uses existing property versions; an external gate is ordering state outside the native object. Native properties never contain runtime gates or pending assignment placeholders.

A selected `!` scope determines the mutation's publication and poison scope. It does not change managed ownership into native reference semantics or require copying every descendant. A managed mutation scope cannot contain registered mutable external resources; reject it and retain its value under a repairable guard. Entry is an access reservation and may cover a mixed branch.

## How the four mechanisms work together

Suppose a lookup retains `x` while `x.n = 0`, then a mutation will set `x.n = 1` after asynchronous work:

1. The lookup marks the retained managed value shared.
2. The mutation uses COW to preserve that earlier value.
3. Its unfinished publication is gated.
4. A later lookup through the mutated owner waits and sees `1`; the retained earlier value still contains `0`.

Temporary observation uses a lease instead of permanent sharing when its source does not escape. If it returns part of that source, sharing must take over before the lease ends. Observations returning only a number need no lasting receiver protection.

Wait only for the earlier values and effects an operation actually consumes. Reading a ready sibling need not wait for an unrelated pending property. Merely obtaining a managed parent does not require resolving its entire subtree.

## External observations and mutations

For overlapping external scopes, each observation waits for preceding mutations, and each mutation waits for preceding observations and mutations. Observations overlap; disjoint sibling scopes overlap. A whole-parent observation conflicts with child mutations, and a whole-parent mutation conflicts with all descendant work.

Store reservations in the static external tree. Propagate completion dependencies upward rather than counting children or scanning for unfinished descendants. At each node distinguish direct observations/mutations from subtree observations/mutations. A new observation captures its subtree's mutations and strict ancestors' direct mutations; a mutation captures its subtree's observations/mutations and strict ancestors' direct observations/mutations. Capture those frontiers before publishing its own completion into the relevant node and ancestor frontiers. Never wait for an ancestor's subtree frontier when operating on a child: it contains unrelated siblings.

Completion Promises carry only completion. Scope poison is separate. Clear completed aggregate references only when still current; retain no settled-operation history or phase-specific readiness transport. The full reservation, entry-ownership, and poison algorithms are in [external context ordering](external-context-ordering.md#external-phases).

For external `apis`, `apis.config!.init()` and `apis.db!.addUser(1)` overlap. A subsequent `apis!.reset()` waits for both and immediately reserves priority over later child work. All registered scope identities and connecting locations stay fixed, although ordinary unregistered native state can change.

Reserve after earlier managed gates and before waiting for inputs or native work. Capture explicit arguments at issuance. Snapshot reads hold their observation reservation through direct availability and ready-only detached copying. Method calls hold access through direct asynchronous work and required result import, not independent nested result Promises. Property writes export the RHS before writing and retain their mutation reservation through publication of poison or success. Observation-only external identities remain unlocked.

Native methods cannot inspect or mutate managed storage through retained references. Their explicit arguments use the ordinary export contract with no special rule for values above a bang. Method-result import remains nonblocking for nested Promises and retains source-preserving borrowed-result copies where validation requires them.

## Entry reserves access, not mutation authority

Entry supports Cascada reference arguments and delayed control flow. It may select a mixed managed/external branch. Operations issued inside it obey the same bang, ownership, and Error rules as ordinary operations; holding an entry never authorizes a mixed mutation scope.

A mutating managed entry installs its selected placement gate before its callback waits. Ordinary path COW isolates gate installation from shared or leased owners. It need not copy unprotected ancestors or eagerly deep-copy the entered value. Entering a.x leaves a.y available. Managed read-only entry retains its counted lease and permits outside writers to COW; lookup results establish permanent sharing as usual.

A mixed entry also reserves access to external descendants in the tree. A mutating entry reserves exclusive access; a managed read-only entry reserves observation access. Entry at an external node retains exclusive outside protection in either callback mode. A native-property entry is lowered to the deepest enclosing registered external scope; explicitly entering an unregistered native property is invalid. Managed mixed entry is not narrowed or rejected merely for containing external nodes.

Contained external work uses the same reservation algorithm in an entry-scoped view covered by the outer reservation. It does not wait for later outside work already waiting for the entry. Nested views inherit authority and use the same algorithm, without graph copies, an unrelated scheduler, or ownership of outside reservations. The outer reservation waits for captured predecessor work before native access and completes after callback closure and required contained external effects. Independently pending results do not extend those effects.

Managed publication remains separate: after callback closure, publish the current private root through existing placement versions. An already-issued managed child gate or nested entry remains visible at its own path. A ready managed sibling must not wait for unrelated native child effects merely because its parent entry finished issuing commands. Closing a Chain forbids new issuance without cancelling already-issued work.

## Failure follows the same ownership and ordering

A failed mutation adds poison only at its selected scope. Repairable scopes retain their value and store poison separately; ordinary Error-valued data remains replaceable through normal assignment/deletion. Guard changes on managed data are owner-isolated placement metadata transitions, not mutations of shared identity metadata.

External ancestors summarize descendant Errors without owning copies of them. Child poison blocks whole-parent consumption but leaves healthy siblings usable; parent-owned poison blocks every descendant. Full external metadata collection preserves all distinct own and descendant Errors, even when the queried external root owns poison. It never scans opaque native storage. A managed guard remains terminal to ordinary graph queries.

Repair reserves exclusive access and clears repairable Errors throughout the selected subtree, preserving values and fixed locations. Repair-and-call clears first, then performs normal call preparation and invocation under that same reservation; only new failures poison again. It cannot bypass own poison above the selected scope or clear a binding conflict. Native effects are not rolled back. Fatal failure still stops work without cancelling internal gates or introducing a cleanup registry.

## Implementation boundary

Keep existing managed leases, sharing, COW, property versions, and operation-result ownership. Replace external reader groups, binding-entry gates, and dependency-bypass indexes with the common hierarchical reservation design only when their integration behaviors pass. Mixed-entry coordination remains necessary; moving it into the tree is not evidence that its lifetime requirements disappeared.

The expected simplification is one external ordering mechanism and one selected external poison owner, with no valid managed/native mutation composition. Hierarchical scope support adds direct/subtree completion frontiers, entry views, nested discovery, and Error summaries. Do not promise a net line reduction before implementation. Keep managed guard storage for invalid mixed-scope failure and keep borrowed method-result handling; neither is eliminated by this architecture.

Share operation ownership only when complete lifetimes coincide. Output release, managed publication, callback closure, external access, and independent result processing keep their actual last-use rules. Share managed traversal only where capture and delivery semantics match: import is transactional, snapshots require ready data, and indexed Error queries preserve pruning. Rejected experimental abstractions do not become production adapters.
