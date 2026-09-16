# Mutation and observation architecture

Accepted architecture for property operations, method calls, and entry. The [data contract](data-limitations.md) is authoritative; [Phase 9F-A](first-principles-conformance-plan.md#phase-9f-a-scope-coordination-and-managed-rollback) tracks the pending implementation cutover.

## Lease: preserve a value temporarily

A managed lease protects a value that unfinished work still needs. Leases are counted: each reader releases its own lease after its last use. Other readers can continue, and a writer can proceed by copying the protected data.

Use a managed lease for:

- **Arguments awaiting consumption:** while receiver selection or controlled argument processing still needs the original managed values. Release their protection when they have been consumed, copied, or safely retained.
- **Receiver preparation:** while resolving the graph needed by a managed call. This preparation lease ends when the working receiver is isolated; protection of the mutation's pre-operation scope has its own lifetime through publication.
- **Managed rollback:** temporarily protect the selected scope's captured value while its mutation works privately. Use existing ownership and version mechanisms; release operation-only protection after successful publication or transfer retention to the poisoned placement on failure.
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

Before modifying managed data, preserve its selected scope's pre-operation value for automatic rollback as well as values held by other owners. Existing leases, sharing, captured versions, and path COW provide this protection. Working state may be changed in place only when it is already independent of the protected baseline and all other owners.

Use COW for:

- **Managed assignment, deletion, and mutation**, including rebuilding an affected path through protected parents.
- **Controlled Array mutations**, preserving retained values and logical views.
- **Managed method mutation**, isolating the prepared receiver where required.
- **Work inside a managed mutating entry**, using the same ownership rules.

Controlled writes copy only the affected managed structure required by the operation and protect children retained by both versions. A native managed method can write anywhere in its receiver without runtime COW checks, so invoke it on a complete receiver graph isolated from the rollback baseline. Reuse existing complete-graph copying with aliases, cycles, Array structure, and admitted prototypes; no undo log or write-intercepting Proxy is needed.

COW never substitutes another identity for an explicitly mutated external resource. A managed parent containing an external identity still uses ordinary COW; copying the parent grants no new authority over the external child.

## Managed mutation rollback

One managed mutation is the rollback unit. At its ordered turn, after earlier conflicting work and before its first write, retain the selected scope's logical value and captured versions. Do not capture the baseline at early issuance while preceding operations can still change it. Prepare and mutate private working state through the ordinary COW path. Success publishes that state and releases operation-only baseline protection. Failure discards the working state and publishes the original contextual Error at the selected scope, with the baseline retained privately for repair. Failed preparation or copying must not require another copy of the failing value to record poison.

Preserve the existing placement state without awaiting an old target merely to capture rollback. Ready assignment/deletion that can replace a pending value stays ready even if that old value never settles. Retain any existing source version; do not normalize or subscribe to otherwise unused old input solely to create a snapshot. Subsequent consumption after repair follows ordinary availability and source attribution. An absent placement remains distinct from a present undefined value.

Rollback covers required managed writes and final publication for this operation. It does not undo earlier operations, source-Promise settlement, or admission/bookkeeping shared with other work. Captured pending versions continue their original settlement and attribution; preserving a logical value does not freeze availability. A failed prefix before scope selection follows the existing first-failed-placement rule and retains that placement's pre-operation state where present, including its owning Array when required by structural effects.

Array structure belongs to the Array. If publishing failure at a missing index would extend length, poison the Array at its owning placement and retain its whole pre-operation structure; preserve an explicit broader scope. In-range failure can stay local when structure is unaffected. Select the required owner before changing length or installing a structural placeholder, and gate it only while the structural transition is unfinished. Use the same rollback/version mechanism, with no length undo log or poison on every ancestor. See [managed structural effects](error-handling.md#managed-structural-effects).

An independent result Error does not fail a successful mutation: removing an Error-valued Array element may succeed while returning that Error. Ordinary assignment of Error data remains a data write. A direct native method throw, rejection, returned Error, invalid receiver, or failed required publication is a mutation failure. Keep required result Error collection independent of the receiver's publication lifetime.

Repair exposes the retained baseline by clearing scope poison; the failed working receiver is never exposed for user code to reconstruct. A sequence of commands, including an entered callback, is not one rollback unit. Higher-level Cascada guard/recover owns rollback across multiple operations. Exact external resources retain completed native effects on failure.

## Gate: order access around unfinished work

A mutation gate blocks later dependent observations and mutations until the required change is complete. An external read gate lets observations overlap while making the next mutation wait for them. Gates protect access and publication order; sharing and leases preserve earlier managed values.

Use gates for:

- **Pending managed assignment or other mutation:** publish the unfinished value through the affected placement's ordinary Promise version.
- **Asynchronous managed method mutation:** keep the working receiver private until its required mutation and publication finish.
- **Mutating entry:** install the gate before invoking its callback and issue contained work through a private Chain.
- **Pending mutation path selection:** gate the longest reached managed prefix while selection remains unfinished.
- **Mutable external observations and read-only entry:** reserve observation access, waiting for earlier overlapping mutations while allowing other observations to proceed.
- **External mutation, repair, and mutating entry:** reserve exclusive access to the selected subtree before waiting for inputs or performing native work.

A ready ordinary managed mutation needs no new gate. An independent pending result does not justify retaining a gate after its promised state change is complete. A gate on a managed placement uses existing property versions; an external gate is ordering state outside the native object. Native properties never contain runtime gates or pending assignment placeholders.

A selected `!` scope determines the mutation's publication and poison scope; include the owning Array when a narrower placement cannot cover affected Array structure. It does not change managed ownership into native reference semantics or require copying every descendant. Reject a managed scope covering canonical registered mutable external locations, retaining its value under placement poison. Inert external aliases at other locations do not block controlled managed writes; native managed receiver preparation still rejects registered mutable identities. Entry is an access reservation and may cover a mixed branch.

## How the four mechanisms work together

Suppose a lookup retains `x` while `x.n = 0`, then a mutation will set `x.n = 1` after asynchronous work:

1. The lookup marks the retained managed value shared.
2. The mutation uses COW to preserve that earlier value.
3. Its unfinished publication is gated.
4. A later lookup through the mutated owner waits and sees `1`; the retained earlier value still contains `0`.

Temporary observation uses a lease instead of permanent sharing when its source does not escape. If it returns part of that source, sharing must take over before the lease ends. Observations returning only a number need no lasting receiver protection.

Wait only for the earlier values and effects an operation actually consumes. Reading a ready sibling need not wait for an unrelated pending property. Merely obtaining a managed parent does not require resolving its entire subtree.

## External observations and mutations

For overlapping external scopes, each observation waits for preceding mutations, and each mutation waits for preceding observations and mutations. Observations can run concurrently; disjoint sibling scopes can run concurrently. A whole-parent observation conflicts with child mutations, and a whole-parent mutation conflicts with all descendant work.

Store reservations in the static external tree. Propagate outstanding completion membership upward rather than counting children or scanning for unfinished descendants. Distinguish direct observations/mutations from subtree observations/mutations. A new observation captures its subtree's mutations and strict ancestors' direct mutations; a mutation captures its subtree's observations/mutations and strict ancestors' direct observations/mutations. Capture a fixed wait before publishing the new membership; later work cannot extend it.

Completion carries no poison. Each completed operation removes its own membership, even while a sibling remains pending. Do not build rolling Promise aggregates that retain completed sibling history. Empty membership adds no wait, and ready completion removes membership synchronously. The full reservation, entry-ownership, and poison algorithms are in [external context ordering](external-context-ordering.md#external-phases).

For external `apis`, `apis.config!.init()` and `apis.db!.addUser(1)` overlap. A subsequent `apis!.reset()` waits for both and immediately reserves priority over later child work. All registered scope identities and connecting locations stay fixed, although ordinary unregistered native state can change.

Reserve in the correct ordering view before waiting for inputs or native work; native access must also pass earlier managed gates. Phase 9F-A evaluates whether static scope selection permits reservation at issuance and removes separate preselection tracking. Capture explicit arguments at issuance. Snapshot reads hold their observation reservation through direct availability and ready-only detached copying. Method calls hold access through direct asynchronous work and required result import, not independent nested result Promises. Property writes export the RHS before writing and retain their mutation reservation through publication of poison or success. Observation-only external identities remain unlocked.

Native methods cannot inspect or mutate managed storage through retained references. Their explicit arguments use the ordinary export contract with no special rule for values above a bang. Method-result import remains nonblocking for nested Promises and retains source-preserving borrowed-result copies where validation requires them.

## Entry reserves access, not mutation authority

Entry supports Cascada reference arguments and delayed control flow. It may select a mixed managed/external branch. Operations issued inside it obey the same bang, ownership, and Error rules as ordinary operations; holding an entry never authorizes a mixed mutation scope.

A mutating managed entry installs its selected placement gate before its callback waits. Ordinary path COW isolates gate installation from shared or leased owners. It need not copy unprotected ancestors or eagerly deep-copy the entered value. Entering a.x leaves a.y available. Managed read-only entry retains its counted lease and permits outside writers to COW; lookup results establish permanent sharing as usual.

A mixed entry also reserves access to external descendants in the tree. Every read-only entry reserves observation access; every mutating entry reserves exclusive access, including when the entry root is external. A native-property entry is lowered to the deepest enclosing registered external scope; explicitly entering an unregistered native property is invalid. Managed mixed entry is not narrowed or rejected merely for containing external nodes.

Contained external work uses the same reservation algorithm in an entry-scoped view covered by the outer reservation. It does not wait for later outside work already waiting for the entry. Nested views inherit authority and use the same algorithm, without graph copies, an unrelated scheduler, or ownership of outside reservations. The outer reservation waits for captured predecessor work before native access and completes after callback closure and required contained external effects. Independently pending results do not extend those effects.

Managed publication remains separate: after callback closure, publish the current private root through existing placement versions. An already-issued managed child gate or nested entry remains visible at its own path. A ready managed sibling must not wait for unrelated native child effects merely because its parent entry finished issuing commands. Closing a Chain forbids new issuance without cancelling already-issued work.

## Failure follows the same ownership and ordering

A failed managed mutation discards its private changes and retains its pre-operation value beneath scope poison in owning-placement metadata. Extend existing logical versions rather than adding a poisoned-object category or storing recovery data in the Error. External failure retains the actual native state and stores poison in the external tree. Ordinary Error-valued data remains distinct; final replacement/deletion of a replaceable managed location may discard either ordinary Error data or scope poison, subject to fixed-resource restrictions.

External ancestors summarize descendant Errors without owning copies of them. Child poison blocks whole-parent consumption but leaves healthy siblings usable; parent-owned poison blocks every descendant. Full external metadata collection preserves all distinct own and descendant Errors, even when the queried external root owns poison. It never scans opaque native storage. A managed guard remains terminal to ordinary graph queries.

Repair uses the selected placement's ordinary managed ordering and any covered external reservation. It clears selected managed scope poison to expose the preserved baseline and clears repairable external subtree poison without reverting native effects. It does not rewrite retained managed contents or erase independent earlier failures. Repair-and-call clears first, then runs a new mutation under the same required protection; its rollback baseline excludes deliberately cleared poison. Own poison above the target and binding conflicts remain blockers. Fatal failure stops work without cancelling gates or adding a cleanup registry.

## Implementation boundary

Keep existing managed leases, sharing, COW, property versions, and operation-result ownership. Replace external reader groups, binding-entry gates, and dependency-bypass indexes with the common hierarchical reservation design only when their integration behaviors pass. Mixed-entry coordination remains necessary; moving it into the tree is not evidence that its lifetime requirements disappeared.

The end state uses one external ordering algorithm, owning-placement poison for managed state, and automatic rollback of each failed managed mutation. Hierarchical external scopes add direct/subtree completion frontiers, entry-local ordering state, nested discovery, and Error summaries. Keep borrowed method-result handling where source and result validation differ. Measure copying and retained state as well as code size; do not promise a net line reduction before implementation.

Share operation ownership only when complete lifetimes coincide. Output release, managed publication, callback closure, external access, and independent result processing keep their actual last-use rules. Share managed traversal only where capture and delivery semantics match: import is transactional, snapshots require ready data, and indexed Error queries preserve pruning. Rejected experimental abstractions do not become production adapters.
