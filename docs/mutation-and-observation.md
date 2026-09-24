# Mutation and observation architecture

Architecture for property operations, method calls, and entry. The [data contract](data-limitations.md) is authoritative. The four mechanisms below have separate jobs: leases and sharing preserve earlier values, COW lets managed writers proceed, and gates order unfinished effects.

## Lease: preserve a value temporarily

A managed lease protects a value that unfinished work still needs. Leases are counted: each reader releases its own lease after its last use. Other readers can continue, and a writer can proceed by copying the protected data.

Use a managed lease for:

- **Arguments awaiting consumption:** while receiver selection or controlled argument processing still needs the original managed values. Release their protection when they have been consumed, copied, or safely retained.
- **Receiver preparation:** while resolving the graph needed by a managed call. This preparation lease ends when the working receiver is isolated; protection of the mutation's pre-operation scope has its own lifetime through publication.
- **Managed rollback:** temporarily protect the selected scope's captured value while its mutation works privately. Use existing ownership and version mechanisms; release operation-only protection after successful publication or transfer retention to the poisoned placement on failure.
- **Managed observations:** while a method or controlled operation can still read its captured receiver, including through its direct Promise.
- **Observation-only managed entry:** while its callback can use the captured value. Lookups through that entry establish lasting sharing when needed.
- **Pending managed path selection:** while an unresolved key prevents capture of the final target, protect the longest reached managed prefix. Reuse that protection across further pending keys.

Delayed controlled copying retains both receiver and payload leases until it establishes output ownership. A lease is unnecessary when the required data has already been captured safely. For example, export copies available data immediately and captures pending property versions; a pending output does not require leasing the entire source. Once arguments are exported, using the independent copies needs no source lease.

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

Controlled writes copy only the affected managed structure required by the operation and protect every child retained by both versions, including the child on the mutation path. A healthy repair, no-op mutation, or entry may leave that child unchanged; pending children must gain the same protection on delivery. A native managed method can write anywhere in its receiver without runtime COW checks, so invoke it on a complete receiver graph isolated from the rollback baseline. Reuse existing complete-graph copying with aliases, cycles, Array structure, and admitted prototypes; no undo log or write-intercepting Proxy is needed.

For a native managed mutating call that reaches invocation, full receiver isolation has graph-sized work and allocation even on success. This is an accepted cost of automatic rollback. Preparation resolves required state and collects Errors before method selection; mutation then uses one complete copier, without first performing observational materialization. Controlled writes retain path COW and Array sharing. Do not make recovery depend on whether the receiver happened to be shared, and do not copy unrelated scope descendants.

Managed observation and mutation use the same receiver graph copier. Observation first identifies containers whose native storage does not match their logical state, together with affected ancestors; other containers map to their existing identity. Mutation starts with no reusable containers. In both cases the copier allocates each copied identity before its children, preserving aliases and cycles. The difference is which nodes need copying, not how their contents are copied.

COW never substitutes another identity for an explicitly mutated external resource. A managed parent containing an external identity still uses ordinary COW; copying the parent grants no new authority over the external child.

## Managed mutation rollback

One managed mutation is the rollback unit. At its ordered turn, after earlier conflicting work and before its first write, retain the selected scope's logical value and captured versions. Do not capture the baseline at early issuance while preceding operations can still change it. Prepare and mutate private working state through the ordinary COW path. Success publishes that state and releases operation-only baseline protection. Failure discards the working state and publishes the original contextual Error at the selected scope, with the baseline retained privately for repair. Failed preparation or copying must not require another copy of the failing value to record poison. Selection blocked by existing scope/ancestor poison preserves its entire recovery state; it does not start another rollback record with the Error as its baseline.

Preserve the existing placement state without awaiting an old target merely to capture rollback. Ready assignment/deletion that can replace a pending value stays ready even if that old value never settles. Retain any existing source version; do not normalize or subscribe to otherwise unused old input solely to create a snapshot. Subsequent consumption after repair follows ordinary availability and source attribution. An absent placement remains distinct from a present undefined value.

Rollback covers required managed writes, destination validation, and final publication for this operation. A destination such as `then` retains its selected scope and baseline until a pending input is known to satisfy its callable-value restriction. Ordinary pending assignment needs no such wait; later input rejection is Error data. Rollback does not undo earlier operations, source-Promise settlement, or admission/bookkeeping shared with other work. Captured pending versions continue their original settlement and attribution; preserving a logical value does not freeze availability. A failed prefix before scope selection retains that placement's pre-operation state, including absence.

Index creation commits Array growth, including when its value is poison or pending data. A failed element operation retains its placement baseline; restoring absence or deleting the element leaves the committed length unchanged. Explicit broader scopes and intrinsic length/remapping operations own the Array and retain its complete structure. Select the required owner before effects and gate only its unfinished transition. Use the same rollback/version mechanism, with no length undo log or poison on every ancestor. See [managed structural effects](error-handling.md#managed-structural-effects).

Keep the requested mutation authority, actual receiver/container, and publication/rollback owner distinct. One selection and publication coordinator derives them from the reached path and category before effects; widening an owner for Array structure does not widen authority. Fixed-location validation considers the requested effects: increasing length or truncating above every registered index is valid, while removing or remapping a registered location is not. Pending selection preserves its ordered prefix capture instead of requiring an extra observation of the path.

An independent result Error does not fail a successful mutation: removing an Error-valued Array element may succeed while returning that Error. Ordinary assignment of Error data remains a data write. A direct native method throw, rejection, returned Error, invalid receiver, or failed required publication is a mutation failure. Keep required result Error collection independent of the receiver's publication lifetime.

Selected mutation completion keeps the state effect separate from the independently delivered result. The publication coordinator applies failure to its applicable owner; validation helpers and failures before selection remain ordinary Error outcomes. A result that retains the published managed identity creates another owner and requires sharing. Derive that alias from the actual values and existing result-import rules rather than recording a second returns-receiver fact.

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

A managed mutation queued at a pending placement owns a new publication version. Predecessor delivery alone cannot expose ready state through that version: the queued mutation must first take its ordered turn and publish its change or install its remaining gate. Keep the source availability signal so supported synchronous thenables can still make immediate progress. Also retain the existing producer Promise while publication is unfinished: a copied version may still expose a settled source signal while its producer waits on another gate. Consumers then wait for the producer, without polling the settled signal or treating it as ready data. Earlier captures continue to follow their own versions; never reconcile them against a later live placement. Selecting a native receiver through managed parents observes those parents and uses external reservations for mutation ordering.

An observation captured through a pending transition may resume after publication has already made its value accessible to later synchronous writers. Record that capture on the version and mark its eventual managed value shared before publishing it. Copies and gate handoffs preserve this retention obligation. The observation boundary requests this protection explicitly; an operation owner's presence or lifetime does not imply ownership. Ordinary source delivery uses its existing FIFO ordering; publication alone, without a retained capture, does not require permanent sharing. Temporary consumers still release leases at their last use, and a closed consumer starts no new capture or local work.

Placement capture preserves Boolean presence, value or source version, and recovery together. Version construction copies those contents and unfinished source dependencies while retaining separate publication authority and capture obligations for the destination. Publication commits the complete placement through the common storage/index transition and releases finished producer dependencies. Uninstalled staging and detached captures can advance their own state without modifying live storage. Import uses these same mechanics but keeps admission, validation, and abandonment transactional; generic version helpers do not admit import data early.

Installed fixed and Promise-backed versions use the same publication path, including without physical writeback. Logical presence is authoritative; consumers enumerate installed versions alongside physical properties. Retire an absent overlay only after its writers finish and physical fallback is also absent. Array index creation commits logical length with the placement; export, copies, receiver preparation, and ready external snapshots use that length. Physical ArrayView reuse additionally requires that the storage window represents the logical length.

Final replacement and deletion wait for an unfinished transition at their target, including an entered root. They do not wait for an ordinary pending data value they replace. Gate publication and value availability therefore have distinct signals: publishing pending data releases replacement ordering while captured value consumers continue to wait for that data. COW copies preserve this distinction with the captured version. Reconstruct an operation's owning path once; deferred completion publishes through its captured placement and never reattaches an earlier parent over later sibling writes.

A selected `!` scope determines the mutation's publication and poison scope; include the owning Array when a narrower placement cannot cover affected Array structure. It does not change managed ownership into native reference semantics or require copying every descendant. Reject a managed scope covering canonical registered mutable external locations, retaining its value under placement poison. Inert external aliases at other locations do not block controlled managed writes; native managed receiver preparation still rejects registered mutable identities. Entry is an access reservation and may cover a mixed branch.

## How the four mechanisms work together

Suppose a lookup retains `x` while `x.n = 0`, then a mutation will set `x.n = 1` after asynchronous work:

1. The lookup marks the retained managed value shared.
2. The mutation uses COW to preserve that earlier value.
3. Its unfinished publication is gated.
4. A later lookup through the mutated owner waits and sees `1`; the retained earlier value still contains `0`.

Temporary observation uses a lease instead of permanent sharing when its source does not escape. If it returns part of that source, sharing must take over before the lease ends. Observations returning only a number need no lasting receiver protection.

Wait only for the earlier values and effects an operation actually consumes. Reading a ready sibling need not wait for an unrelated pending property. Merely obtaining a managed parent does not require resolving its entire subtree.

## Placements, structure, and storage

Ordering and ownership act on logical values. Native storage is their representation and may temporarily differ from them. Keep three responsibilities separate:

| Responsibility | Authority | Common implementation |
| --- | --- | --- |
| A property's value, presence, unfinished transition, and repair baseline | The captured placement version; physical data is fallback when no version exists | [Property versions](../src/property-versions.js) and [language properties](../src/language-properties.js) |
| Array length and record key order | The container's captured structural state | [Structural publication](../src/placement-structure.js) and [Array length](../src/array-length.js) |
| Where bytes are stored and whether storage can be reused | The selected native representation | [ArrayView](array-view.md) and ordinary own data properties |

A placement publication commits both its property state and any creation/deletion effect on the container. Gates, copies, and Error outcomes use this same publication boundary. Protection by itself commits neither a property nor growth. A later deletion does not undo an earlier Array growth, so the final property value alone cannot reconstruct structural effects. Record key order likewise depends on creation, deletion, and recreation, not only on final presence.

Every logical consumer uses the common property layer, including for ArrayViews. Candidate enumeration merges physical keys and installed versions; an undecided candidate may later become absent. Bounded Array operations filter both sources to their consumed range. A version can therefore protect an absent element without extending native storage or creating a second kind of hole.

A copy captures properties and structure at the same program position. A complete consumer, such as export or native receiver preparation, finishes those captured dependencies and materializes the resulting shape. COW can instead preserve their pending state. Neither rereads later live structure to finish an earlier copy. [Array shape and pending placements](array-view.md#captured-shape-and-pending-placements) explains why length questions can finish independently of element values.

Promise settlement may synchronize owned storage with its logical version, avoiding later materialization. That write is optional: supported refusal leaves the logical value intact. Actual mutation publication is required work and retains its normal poison and rollback semantics. ArrayView settlement never writes a retained slot shared with another owner.

## External observations and mutations

For overlapping external scopes, each observation waits for preceding mutations, and each mutation waits for preceding observations and mutations. Observations can run concurrently; disjoint sibling scopes can run concurrently. A whole-parent observation conflicts with child mutations, and a whole-parent mutation conflicts with all descendant work.

Store reservations in the static external tree. Propagate an undominated pending frontier upward rather than counting children or scanning for unfinished descendants. Distinguish direct observations/mutations from subtree observations/mutations. A new observation captures its subtree's mutations and strict ancestors' direct mutations; a mutation captures its subtree's observations/mutations and strict ancestors' direct observations/mutations. Capture a fixed wait before publishing the new membership; later work cannot extend it. After capture, a mutation replaces earlier frontier entries in the same view at its scope or descendants, because it now orders every later conflict with them. Keep strict-ancestor and unrelated entries.

Completion carries no poison. Replacing a frontier entry does not complete its operation, release its resources, or remove its entry lifetime membership. Actual completion removes any remaining scheduling membership idempotently, even while a sibling remains pending. Do not build rolling Promise aggregates or retain every queued writer as a direct predecessor. Empty membership adds no wait, and ready completion removes membership synchronously. The full reservation, entry-ownership, and poison algorithms are in [external context ordering](external-context-ordering.md#external-phases).

For external `apis`, `apis.config!.init()` and `apis.db!.addUser(1)` overlap. A subsequent `apis!.reset()` waits for both and immediately reserves priority over later child work. All registered scope identities and connecting locations stay fixed, although ordinary unregistered native state can change.

Capture explicit arguments and the issuing view, and reserve statically selected external coverage at issuance before managed gates can wait. Continue managed path capture without first awaiting external predecessors; selected native work waits for both. Use that one reservation completion for enclosing-entry lifetime and ordering. A managed-prefix reflection failure publishes placement poison without acquiring broader native coverage; an existing reservation still completes after its predecessors, even when local failure is already available. Snapshot reads hold observation coverage through direct availability and ready-only detached copying. Method calls hold access through direct asynchronous work and required result import, not independent nested result Promises. Property writes export the RHS before writing and retain their reservation through publication of poison or success. Observation-only external identities remain unlocked.

Capture managed namespace state at that ordered path turn. After external waiting, recheck binding authority and the ordered external poison state, without acquiring a later managed gate or version as a new prerequisite. A later mixed entry may already be waiting for this operation; rescanning its live gate would reverse that dependency. Batch reference selection starts every disjoint path in its original issuance turn; an unrelated slow argument cannot postpone a ready argument's reservation.

Native methods cannot inspect or mutate managed storage through retained references. Their explicit arguments use the ordinary export contract with no special rule for values above a bang. Method-result import remains nonblocking for nested Promises and retains source-preserving borrowed-result copies where validation requires them.

## Entry reserves access, not mutation authority

Entry supports Cascada reference arguments and delayed control flow. It may select a mixed managed/external branch. Operations issued inside it obey the same bang, ownership, and Error rules as ordinary operations; holding an entry never authorizes a mixed mutation scope.

Entry captures the narrowest directly selectable managed placement or statically selected registered external scope. Unavailable, missing, primitive, poisoned, intrinsic, or unreadable suffixes remain a relative path on that reference. Its protection anchor stays fixed. Resolve preceding placement transitions and external predecessors before callback activation, but do not await ordinary pending data just to select an unused suffix. Supported inspection failure stops optional discovery without creating poison; contained commands consume and validate their destinations at their own operation contexts. Managed mutable anchors use ordinary metadata-only gates with necessary COW for owner isolation. Ready readonly anchors use leases; pending captures retain their source version before transfer. Protection alone neither writes storage nor creates a placement. Array-index entry protects its element, including holes and out-of-range indexes. Protection creates no physical slot and commits no growth. Register a possible index + 1 contribution at issuance, before predecessor waits. A contained creation, including pending data or poison, commits growth immediately while the element gate remains closed; later deletion or repair to absence does not shrink length. Complete no-growth only after required contained transitions and final publication finish, including queued entries inheriting presence. Array methods publish independently owned placements through remaps or derived views. Retained placements carry their captured transitions without delaying publication of the new Array; discarded placements have no write authority over it. Methods wait only for required arguments, shape, or consumed values. Direct length assignment waits for transitions in its truncated suffix before changing live placements.

Placement publication commits presence, value, recovery, indexed edges, and structural effects together. Entered private references publish committed creation/deletion through their captured source placement; required storage failure remains a command failure, while protection-only installation/completion performs no physical write. Record order preserves replacement and no-op positions and moves a deleted/recreated string key after earlier creations. Numeric keys retain numeric order. Captured copies and native receiver preparation use these same logical facts.

Each logical Array or ArrayView owns its length knowledge. Its ordered growth contributions and length/range questions preserve captured prefixes: the minimum is committed growth, and the maximum also includes unresolved bounds. Exact length is ready when bounds coincide; a range question can answer earlier. Forks share earlier outcomes but exclude later contributions and operation watchers. Coalesce adjacent settled growth and unlink completed watchers, including behind an unresolved head. Pending watchers use the existing operation owner and release-on-close mechanism. Intrinsic length reads create no property version or graph Promise edge.

A mixed entry also reserves access to external descendants in the tree. Every read-only entry reserves observation access; every mutating entry reserves exclusive access, including when the entry root is external. A native-property reference retains its suffix relative to the deepest selectable registered scope; contained access performs validation. Managed mixed entry is not narrowed or rejected merely for containing external nodes.

Contained external work uses the same reservation algorithm in an entry-scoped view covered by the outer reservation. It does not wait for later outside work already waiting for the entry. Nested views inherit authority and use the same algorithm, without graph copies, an unrelated scheduler, or ownership of outside reservations. Entry waits for captured predecessors before invoking its callback. Actual contained commands check binding and scope poison; setup does not consume an unused reference. Outer coverage completes after callback closure and required contained external effects. Independently pending results do not extend those effects.

Managed publication remains separate: after callback closure, publish the current private root through existing placement versions. If a contained transition still controls that root's placement, follow its structural completion before publishing; ordinary pending data does not extend that wait. Failed entry publication records present poison and retains the completed placement for repair, including absence, without rolling back earlier contained commands. An already-issued managed child gate or nested entry remains visible at its own path. A ready managed sibling must not wait for unrelated native child effects merely because its parent entry finished issuing commands. Closing a Chain forbids new issuance without cancelling already-issued work.

## Failure follows the same ownership and ordering

A failed managed mutation discards its private changes and retains its pre-operation value beneath scope poison in owning-placement metadata. Extend existing logical versions rather than adding a poisoned-object category or storing recovery data in the Error. External failure retains the actual native state and stores poison in the external tree. Ordinary Error-valued data remains distinct; final replacement/deletion of a replaceable managed location may discard either ordinary Error data or scope poison, subject to fixed-resource restrictions.

External ancestors summarize descendant Errors without owning copies of them. Child poison blocks whole-parent consumption but leaves healthy siblings usable; parent-owned poison blocks every descendant. Full external metadata collection preserves all distinct own and descendant Errors, even when the queried external root owns poison. It never scans opaque native storage. A managed guard remains terminal to ordinary graph queries.

Repair uses the selected placement's ordinary managed ordering and any covered external reservation. One placement transition restores the preserved baseline and removes its poison; it also clears covered repairable external metadata before releasing protection. Complete fallible preparation/publication first so a supported failure preserves both the managed recovery state and external poison. No native effects are reverted. It does not rewrite retained managed contents or erase independent earlier failures. Repair-and-call clears first, then runs a new mutation under the same required protection; its rollback baseline excludes deliberately cleared poison. Own poison above the target and binding conflicts remain blockers. Fatal failure stops work without cancelling gates or adding a cleanup registry.

## Implementation boundary

Use managed leases, sharing, COW, property versions, and operation-result ownership together with the common hierarchical external reservations. Mixed entry composes those mechanisms while preserving their distinct lifetime requirements.

The end state uses one external ordering algorithm, owning-placement poison for managed state, and automatic rollback of each failed managed mutation. Hierarchical external scopes add direct/subtree completion frontiers, entry-local ordering state, nested discovery, and Error summaries. Keep borrowed method-result handling where source and result validation differ. Measure copying and retained state as well as code size; do not promise a net line reduction before implementation.

Share operation ownership only when complete lifetimes coincide. Output release, managed publication, callback closure, external access, and independent result processing keep their actual last-use rules. Share managed traversal only where capture and delivery semantics match: import is transactional, snapshots require ready data, and indexed Error queries preserve pruning. Rejected experimental abstractions do not become production adapters.
