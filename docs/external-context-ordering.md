# External Context Ordering Architecture

The developer-facing contract is [data-limitations.md](data-limitations.md). This document specifies the accepted external-tree design; the implementation and verification work is tracked by [Phase 9F-A](first-principles-conformance-plan.md#phase-9f-a-replace-external-scope-coordination). It does not claim that the current source already implements this end state.

## Model

Managed state uses leases, sharing, COW, and placement versions. External state retains exact native identities; its access reservations and poison live in the external mutation tree, never in native properties. Observation-only external identities remain unlocked under their read-only host contract.

A mutable external subtree can contain nested registered scopes. `apis.config!.init()` and `apis.db!.addUser(1)` may overlap, while `apis!.reset()` excludes both subtrees when `apis` is external. Each mutation may change only state within its selected external scope. Parent-owned native methods may change descendant state but preserve every registered identity and location. Hidden writable overlap between supposedly independent siblings violates the host contract.

A managed mutation scope cannot contain registered mutable external resources. Reject that scope before invoking code and poison its selected managed root, preserving its value for repair. Observation-only external references remain permissible opaque leaves. Entry is different: it reserves access, may select a mixed branch, and grants no mutation authority. Its contained operations independently obey these scope restrictions.

Two scopes overlap when one is an ancestor of the other or they are equal. Ordinary external operations conflict exactly when their scopes overlap and at least one mutates. Observations overlap; disjoint sibling scopes overlap. Entry adds its explicit access reservation without changing this rule for operations issued inside it.

## Static external mutation tree

`ContextChain(initialValue, operationContext, mutationAccessTree = undefined)` follows the compiler's finite tree of named static paths during the initial synchronous import transaction. Nodes are own String-keyed maps with `{}` endpoints. The compiler supplies no runtime metadata and retains ownership of its unchanged input. [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree) defines construction.

Follow only requested original own data placements. Missing values, primitives, Errors, Functions, accessors, and Promise/thenable sources contribute no scope. A thenable is not directly accessible even if ordinary import has synchronously delivered its value. Ordinary import continues its usual thenable processing independently. Discovery invokes no getters, enumerates no unrelated native subtree, and consumes one compiler-tree edge at each recursive step; cycles require no extra discovery walk.

At a managed node, reuse staged/admitted category facts and retain only connecting paths to external scopes. At the first external node, record its exact location and continue through requested native data properties to discover nested external scopes. A previously unadmitted native object reached in that region stays external for this purpose; stage its external admission with the registration. Never reclassify an already-managed identity. Such a managed endpoint adds no external scope and cannot grant native access to managed storage. Prune managed endpoints and empty connecting branches. Do not promote an entire managed branch merely because it contains external state.

Every visited external object on a requested route can be a scope, including a branch with children. No endpoint-used flag is required. Stage identity-to-location proposals and all related admission changes atomically. Two distinct selected paths to the same exact external identity fail the import segment with `ExternalLocationConflict`; finite selected cyclic aliases obey the same rule. Abandoned discovery commits no admissions, sharing, versions, tree nodes, or registrations, and its pending import callbacks cannot publish. Independent valid context registrations instead invalidate their shared identity binding at commit as described below.

### Runtime nodes and identity validation

Keep child property maps separate from internal fields by placing all runtime facts behind one internal Symbol. A node can have children and an external location record simultaneously. Its internal record contains canonical location/provenance, the external identity binding entry when applicable, reservation aggregates, and owned poison/error-summary state. Connecting managed namespace nodes need reservation and guard references but grant no external mutation authority. Do not reserve public child names such as `path`, `context`, or `__proto__` for metadata. Store child keys as safe own properties.

The location is fixed for the execution and identifies one original context and canonical static path. Entered Chains refer to the same nodes, not copied registration trees. At a native access, compare the reached identity's execution-local binding entry with the selected location. An unexpected changed identity at a committed location is a fatal host-contract violation; supported off-path access produces local poison. Keep the actual method receiver operation-local; a suffix receiver need not be a registered scope. Add no second receiver registry or mutable-node discovery cache.

Registered identities and the placements connecting them cannot be replaced, deleted, or moved. Unregistered ordinary native properties, objects, and Arrays may change within the selected authority. Structural operations on managed ancestors must preserve those fixed paths; ordinary sibling properties remain mutable. Poison and entry retain the underlying value and never write placeholders into native storage. Commit never grows or prunes the tree in response to Promise delivery, COW, repair, or binding conflict.

## Identity binding map

One execution-local WeakMap maps each registered external identity to its valid location or permanent conflict Error. The corresponding tree node owns ordering and repairable poison. Conflict is not repairable poison and repair creates no authority.

| Reached state | Outcome |
| --- | --- |
| No registration | Observation-only external behavior; no mutation authority |
| Correct registered canonical location | Reserve the selected tree scope |
| Registered identity reached through an unrelated Chain or alias | Local `ExternalLocationConflict`; do not poison its legitimate location |
| Competing independently committed context registrations | Shared permanent binding Error; neither context gains precedence |

Import, inert storage, and managed copying create no registration. Regular-Chain import before or after a context does not invalidate that context. Pending off-path use rechecks authority before native access. Completed host effects or exposed results are not revoked retroactively; no reverse alias list or exposure history is maintained. Each execution has independent bindings; a mutable host identity must not be coordinated by multiple executions.

When a valid binding becomes conflicted at import commit, use its previous location before replacing the binding to propagate nonrepairable Error presence through that existing tree. Seed the newly committed location's summary from the same conflict. Further competing contexts seed their own paths; previously conflicted paths already remain marked. This needs no list of aliases or reverse placement registry. Repair recomputes presence from remaining own poison, child membership, and binding conflict, so clearing repairable state cannot hide permanent conflict.

## Routing and capture points

Retain two locations: the first crossing from managed into native state, and the selected registered external scope. The first determines boundary conversion; the second determines ordering, poison, and mutation authority. Traverse only the requested tree path to select the scope, then perform native reflection after its prerequisites. Do not acquire one reservation per encountered external object.

An explicit external `!` prefix selects its registered node. A deeper unregistered suffix remains within its nearest registered external scope. Default external property mutations and observations select the deepest registered prefix of the containing/receiver path; a final read of a registered resource consumes that resource's subtree. A parent `!` deliberately widens authority and locking to the parent. `apis.db!.init()` therefore differs from `apis!.db.init()` when both locations are registered. A managed `apis` cannot be such a widened mutation scope, but can be an entered namespace.

Every registered location actually selected or crossed requires a static source prefix, not merely resolved String/Number keys. Preserve `firstDynamicSegment` through entry and relative-path composition. Keys within an unregistered native suffix may be dynamic but cannot dynamically select a registered descendant; reject that use before accessing the descendant. Dynamic invalid observations return local poison. Invalid mutations poison the deterministically selected scope/static prefix under the ordinary mutation-failure rule, without candidate reservations. Previously encountered poison takes precedence. A tree containing child scopes must not silently normalize a dynamically selected child into static authority at its parent.

Capture inputs at issuance. Pass earlier managed placement gates before reserving external work; otherwise outside work can reserve a turn needed by an entry whose gate it awaits. Once at that turn, capture all conflicting predecessor reservations and install the new reservation synchronously before awaiting prerequisites, argument export, native-suffix keys, or host effects. Native work starts only after required inputs and captured predecessors finish. Recheck binding authority before host access after a wait without recapturing later ordering state.

## External phases

An external reservation has one fulfillment-only completion Promise. Completion means all effects and boundary processing promised by that operation are finished. It carries no poison payload. Fatal failure never resolves, rejects, or cancels internal reservations; public fatal-result handling remains separate.

Use upward completion aggregation, not unfinished-child counters or descendant scans. A node distinguishes completion dependencies for direct observations, direct mutations, subtree observations, and subtree mutations. These are dependency frontiers, not four independent schedulers. A subtree frontier includes direct work at that node. An operation contributes the same completion Promise to its selected node's direct frontier and the matching subtree frontier on that node and each ancestor. Connecting managed nodes aggregate external activity too, for mixed entry and guard transitions.

| New operation at node N | Earlier dependencies to capture |
| --- | --- |
| Observation | N's subtree mutations; direct mutations at strict ancestors |
| Mutation or repair | N's subtree observations and mutations; direct observations and mutations at strict ancestors |

The strict-ancestor lookup deliberately excludes their subtree aggregates: those include unrelated siblings. A whole-parent observation waits for descendant mutations and blocks subsequent descendant mutations; it is not equivalent to a descendant announcing activity at its parent.

Capture before adding the operation's own completion. Aggregate with ordinary guarded Promise composition over the previous pending frontier and the new completion. Clear a completed frontier only if it is still the node's current frontier, so an older cleanup cannot erase newer work. Clear references after completion and allocate no settled-operation history. Work is bounded by the selected path and outstanding dependency edges, not native graph size. A replacement implementation may eliminate transitively redundant dependencies while preserving the table, but adds no second queue, per-node ready transport, or child counter.

For `config.init(); db.addUser(); reset(); db.read()`, the sibling writes capture no dependency on each other. Reset captures both through the parent's subtree frontier and publishes its own direct mutation reservation. The later read captures reset. Recording child work at a parent must neither block siblings nor include later children in reset's captured prerequisites.

### Entered branches

Mixed entry remains supported. A mutating entry gates the selected managed placement through ordinary versions and path COW, and reserves exclusive external access to its tree subtree before its callback can wait. An entry rooted at a registered external node reserves that subtree directly, with no native-property or contextual-binding gate. A native-property entry below a registered node is still invalid; compiler selection chooses the deepest enclosing registered node. Read-only entry at a registered mutable external scope retains exclusive outside protection, even though its callback cannot mutate. Entry into an unregistered observation-only external identity acquires no mutable-resource reservation. A mixed read-only managed entry leases its captured managed root and reserves observational access to external descendants: other observations overlap, descendant mutations wait. No tree branch means no external reservation.

Entry itself performs no native data consumption: preserve poison at its selected external subtree so contained explicit repair can run; strict-ancestor own poison and invalid bindings still block entry. Ordinary contained reads/calls check poison normally.

Contained work must not rejoin an outside reservation that is waiting for that entry. Use a reservation view scoped to the entry's covered subtree: the outer reservation captures earlier global work; contained operations use the same frontier algorithm within that view. Entry views carry inherited authority and the covered node, not a second native queue or copies of data/registration nodes. Nested entry publishes a reservation in its parent's view and applies the same rule. Work cannot escape its covered subtree or readonly capability; reference arguments to Cascada functions use these same entries. Do not grant ownership of unrelated outside reservations.

Register coverage for external-bound commands at original issuance, before a managed gate can defer their actual native reservation. Aggregate an entry-owned completion obligation for that command; if it ultimately selects no native work, complete the obligation at that handoff. Otherwise retain it through the required external effects, not an independent result. This obligation records lifetime only and neither queues the action nor bypasses earlier managed work. Capturing only already-created native reservations at callback closure would miss these delayed commands.

Closing an entry stops new issuance. Capture its contained external completion frontiers at that point and release the outer external reservation when those effects, including already-issued nested entries, finish. A contained ordinary operation contributes its required effect lifetime, not an independent nested result Promise. The entry's callback result and managed graph publication retain their separate existing lifetimes. A mixed entry may publish a managed root whose ready sibling is usable while a native child's external reservation remains pending. Never hold the entire managed root gate until all native descendants settle.

This view is only an ownership boundary for the common external reservation algorithm. Managed child gates and property versions still carry managed pending work after parent publication. Before choosing a representation, verify nested child entry surviving parent callback closure, a later parent reservation waiting on a child whose callback continues issuing work, sibling progress, and fatal resumption. Do not preserve the old dependency-bypass graph alongside this view after cutover.

## Poison and repair

Each failure belongs to exactly one selected scope. External nodes store `ownPoison` separately from completion dependencies; native storage remains unchanged. A descendant Error is never installed as ancestor-owned poison. Maintain the set of immediate child branches containing poison at each node, propagating empty/nonempty changes upward without occurrence counts or persistent compounded wrappers. The tree is acyclic even when the host graph is not. Binding conflicts remain permanent errors and are included in contextual queries separately.

An operation targeting N checks own poison on strict ancestors, then required poison in N's subtree after its conflicting predecessors complete. Ancestor-owned poison blocks all descendants with its original Error. A sibling's Error does not block a child operation through a derived parent summary. Whole-parent work consumes the complete subtree Error union and skips native code when blocked. Observations add no poison. A blocked mutation likewise adds no new poison.

A parent metadata query holds one covering observation reservation and reads the required child records under it. It never reacquires child reservations behind a later parent mutation already waiting for that query. Capture original Error references before releasing that reservation; later repair cannot alter the returned collection.

`hasError` can stop on a proof. `getErrors` gathers original Errors from the selected external metadata subtree, including independent child poison even when its selected root also owns poison, without inspecting native contents or awaiting retained managed data. Combine through the existing idempotent Error factory: null for none, the exact original Error for one, and a flattened compound preserving every distinct cause/source/kind for several. Do not repeatedly wrap or reattribute propagated Errors. Access blocked at a poisoned strict ancestor returns that blocker instead of navigating into its subtree. Ordinary managed guard queries remain terminal at that guard; this external metadata collection does not reopen hidden managed recovery graphs.

Repair-only reserves exclusive access, preflights target/placement selection and checks registration and poison above its target, then clears repairable poison throughout the selected subtree and updates ancestor summaries. It invokes no native code and returns undefined; once valid and reachable, it has no recoverable failure of its own. Permanent binding conflicts remain; a subsequent whole-subtree call still sees a conflicting child and cannot run. Repair-and-call performs that clearing first under the same exclusive reservation, then normal preparation and invocation. A new preparation/call failure poisons the selected scope; deliberately cleared old Errors are not combined back in. Repair is neither rollback nor evidence that native physical state was restored.

A managed mixed-scope validation failure retains its underlying value in owner-isolated placement metadata, as defined in [scope transitions](error-handling.md#scope-transitions). Its own poison blocks contextual native descendants too. Ordered subtree repair can clear the guard and descendant external poison while retaining the fixed locations. A managed guard's tree reference points at the authoritative placement record; it is not another poison copy.

## Host boundary

External methods operate on native receiver-owned state, not raw managed parents, siblings, or aliases. Observation-only external references in managed methods remain opaque: retain/compare them if permitted, but do not inspect or mutate their host state. All host arguments use the existing preparation/export and argument ownership contract; source position above or below `!` creates no additional mutation permission. There is no special ancestor-argument mode.

External calls and property writes use common guarded host boundaries and action-specific Error kinds. A native setter/reflection throw or false write/delete poisons the selected mutation scope; exporting an Error-valued RHS skips native storage and poisons that scope. Every observation Error affects only its result. Already performed native effects are not rolled back.

Method results use ordinary causal import, not implicit snapshots. Return independent managed data or relinquish mutation of it. Ready results remain available while nested Promises are pending. Existing managed results are read through logical placements and preserve their source versions. Result-specific validation may need selective borrowed-container copies; retain that mechanism and its aliases, cycles, source attribution, and independent nested-result lifetime. No ready-only result restriction or full-result await is introduced.

Registered mutable identities remain receiver capabilities. Host-input export, direct extraction, callback exposure, and method-result escape fail through existing capability rules. Traversing from a selected parent into its registered descendant under enclosing authority is not off-path use, but each reached fixed identity must match its registered location. Hidden aliases, sibling-crossing effects, and later receiver access from independent nested result work remain excluded host behavior.

## Managed and external ownership

Managed lookup, argument capture, import, and retained results keep ordinary sharing, leases, COW, and placement versions. Copying a parent grants no native authority. Managed methods consume their complete receiver and reject registered mutable external descendants; no extra subtree scan is needed beyond receiver preparation. Canonical scope selection can use the fixed tree to reject a mixed scope before invoking a method. Tree absence on an off-path alias is not proof that its managed receiver lacks registered resources.

Entry grants access ordering only. Gate installation uses ordinary ancestor COW when sharing or leases require placement isolation; an unprotected ancestor needs no copy. Entering does not eagerly deep-copy its selected value. Actual contained managed mutation decides its own COW. Source origin, Error attribution, and previously captured outputs remain unchanged through poison and repair.

## Snapshot transaction

Property reads from mutable external state hold their observation reservation through direct availability and detached snapshot construction. Snapshot only the requested result graph; a direct Promise may resolve first, but nested pending data is invalid and is not subscribed. Native sources are not admitted before snapshot classification. Already-managed sources use logical property versions and Array projections, including sparse topology and native logical length. Snapshotting does not allow direct native mutation or traversal into raw managed storage by host methods.

Copy managed-compatible records, Arrays, and class state with their supported prototypes, aliases, and cycles; preserve Functions and permitted exact observation-only leaves. Reject registered mutable capabilities wherever encountered. Stage copies and admissions atomically, collect every discoverable Error, and discard incomplete output on failure. Ready reflection failure receives the snapshot boundary's Error kind; internal invariant failure remains fatal. Share traversal with export only where capture and readiness semantics match; no generic mode-driven copier is required.

Observation-only native property results retain their separate external-root import policy and require no mutable reservation. Outbound export uses its normal complete Error collection and independent copies. End source reservations after required capture and processing, not after unrelated nested result availability.

## Verification boundary

Phase 9F-A verifies the conflict table, fixed-location discovery below external nodes, source-staticness, nested/mixed entry views, complete metadata Error unions, recursive repair, and owner-isolated guards together. Preserve existing admission atomicity, context/regular-Chain import-order behavior, immutable outputs, action-specific errors, supported Proxy behavior, and public fatal-result ownership. Do not claim that a smaller helper proves an end-to-end simplification; delete superseded gate indexes, single-owner cursors, and binding gates only as their behaviors pass through the common replacement.
