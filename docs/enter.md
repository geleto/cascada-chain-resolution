# `enter` Path Ownership

## Status

This document specifies the accepted entry architecture. [Phase 9F-A](first-principles-conformance-plan.md#phase-9f-a-scope-coordination-and-managed-rollback) implements its hierarchical external reservations; managed entry continues to use ordinary publication and ownership mechanisms. Entry is an access reservation, not a mutation or a `!` poison scope.

Entry serves Cascada function arguments passed by reference and delayed control flow. It may select a mixed managed/external branch. A mutating entry at `a.x` prevents conflicting outside access there while its callback decides what to issue; `a.y` remains available. Every contained operation independently obeys managed/external mutation scope restrictions. Holding a mixed entry cannot make `apis!.db.write()` valid when `apis` is managed and its canonical route covers registered mutable external locations. Inert aliases elsewhere do not forbid controlled managed writes and grant no external authority.

## API and lifecycle

```js
return enter(chain, path, operationContext, entryMutable, entered => {
    // Issue operations relative to the entered Chain.
    return result;
}, firstDynamicSegment);
```

The result is the callback's value or Promise, or a selection Error. Entered Chains use the ordinary data holder, execution binding, and operation APIs; entry sets a readonly capability where applicable and closes new issuance when callback completion is known. The original external-tree node and static path provenance are retained without a copied registration tree or independent context. A reservation-view reference records the entry's covered external access, not additional mutation authority or a public resolver.

The callback may be asynchronous. A ready value, ordinary poison value, or admitted callback-Promise poison rejection completes entry normally. Unexpected synchronous callback throws and raw internal rejections follow the existing fatal-on-escape contract. Do not invent entry abort, fatal cleanup, cancellation, or a second result representation. Required operation contexts, execution binding, and closed-entry issuance retain their common checks.

Entry selects a location; it does not consume the final target as an ordinary value operation. An Error at that target, including scope poison with a retained baseline, is valid entry input. Transfer its complete logical placement state into the private root before callback work and preserve it on publication. An Error on a strict ancestor still prevents reaching the target. This permits reference functions and entered control flow to inspect, repair, or replace poisoned managed targets under their ordinary capability; read-only entry permits inspection only.

Closing prohibits new calls through the entered Chain, including after a callback Promise settles. It does not discard state needed by already-issued commands or close nested entries still independently active. Native callbacks use the normal export boundary; direct access to private managed state is not a supported reference-argument shortcut.

## Mutating entries

Managed mutating entry installs a Promise-backed gate at its selected logical placement before invoking the callback. `walkMutationPath` performs ordinary ancestor COW and reconstruction. Unshared/unleased ancestors need no copy. Shared or leased ancestors must isolate the gate placement so another owner's earlier output neither waits on this entry nor receives its later publication. Entry itself does not eagerly deep-copy the selected value; contained mutations apply their own COW and receiver preparation.

Create the private Chain and capture the original target/version before detaching it. Install the public gate before subscribing to pending-source transfer. A direct source initializes the private root normally; a pending source forks its exact captured Promise version into that root. If ancestor COW leaves the source reachable elsewhere, preserve sharing at the transfer boundary. Callback invocation happens after required owning-path reconstruction, not after all descendants become ready.

A gate orders current-owner access. Captured earlier versions keep their ordinary values and Promise frontier. Unrelated sibling paths do not wait. Successful entry setup does not add language poison: a contained mutation publishes its selected scope effect, while a callback's independent Error result need not poison the entered value.

## Read-only entries

A managed read-only entry leases its captured root. Count each lease independently and release this entry's lease after its callback finishes. Outside managed mutations may COW rather than wait. Public lookups and retained results establish permanent sharing before temporary protection ends. Primitives and observation-only external identities need no managed read count.

A managed parent lease cannot protect mutable external descendants. Every read-only entry reserves observation access to covered external resources, including when its root is a registered external scope. Other observations overlap, while conflicting native mutations wait through the entry's required access lifetime. Readonly capability prevents contained mutation even when an enclosing entry holds exclusive access. Managed read-only roots additionally keep their ordinary lease; unregistered observation-only external identities need no reservation.

## Mixed and external entries

An entry target may be managed, mixed, or a registered external scope. Mixed entry is intentionally less restrictive than a managed bang mutation scope. Its managed gate/lease protects managed access, and one subtree reservation protects the covered native state. Both use the entry's captured source turn, not a new operation queue.

Registered external entry stores no gate in native properties or in a separate contextual-binding Promise. The common external-tree reservation mechanism protects the subtree. The private Chain holds the same exact native identity and must not replace its root or move registered descendants. As for managed entry, poison at the selected scope is retained for contained inspection or repair; strict-ancestor own poison and invalid binding block selection. Successful entry setup adds no poison. Native operations inside select their own registered scopes and normal failure effects.

Use `selectEntryPath` for compiler lowering. It leaves managed/mixed targets unchanged and maps an unregistered native-property target to its deepest enclosing registered external node. A registered child may be entered independently of its external parent. An explicitly requested unregistered native-property entry returns PropertyValidation, before native child reflection or callback invocation; mutating failure poisons its enclosing selected scope, readonly failure stays local. Existing poison takes precedence. Every registered location crossed must have static source provenance; rebasing does not turn computed segments static.

## Reservation ownership

[External ordering](external-context-ordering.md#external-phases) owns the single direct/subtree frontier algorithm. Before deferred entry work, reserve its covered subtree in the current view and capture earlier conflicting work. An entry creates a covered view in which contained commands use that same algorithm. Outside commands remain in the parent view, where they encounter the entry's reservation. A nested entry creates a nested view under a reservation in its parent's view. Share immutable tree locations and identity binding facts; view-local frontiers are temporary entry ordering state and are released with that view.

This prevents a deadlock such as: child entry A is active; later ancestor entry B waits for A; A issues another contained operation. A's operation uses A's view and cannot queue behind B. It still waits for earlier contained work and cannot exceed its entry's scope or readonly capability. Do not solve this by granting A ownership of B's gate, following a graph of later dependent gates, or cancelling B.

A mutating entry reserves its native subtree exclusively; a read-only entry reserves observation access. Track every issued command that may reach covered native state through its required effect completion, including commands delayed by managed gates. Safe early reservation lets the ordinary reservation perform that tracking. If reservation must be delayed, register the same completion at issuance and reuse it at reservation, with no second completion or parallel retained tracking scheme. Selection failure must publish its required effect before completion. At callback closure stop issuance and capture outstanding completions, including already-issued nested entries, before releasing outer coverage. Do not retain independent nested method-result Promises. Phase 9F-A evaluates and selects one reservation timing implementation.

Managed and external completion must remain separate. A parent managed entry may publish its private graph while a native child remains reserved, so a ready managed sibling is usable immediately. Its native paths still observe the live tree reservations. A contained managed child gate remains in the published graph and preserves its own path availability. Do not hold the entire managed parent gate until every child effect finishes, and do not release external reservation coverage at callback closure while child effects remain.

## Promise frontiers

### Pending ancestors

A pending managed ancestor delays target selection through the normal path walker. Capture its exact version at issuance and run the resumed entry at its FIFO position. Complete path COW and owning-parent writeback before exposing callback work. Later subscribers observe the installed gate; earlier captures retain their own version. Native access cannot pass that managed gate. Any reservation acquired before the gate must belong to the correct ordering view so contained work cannot queue behind the outside reservation; Phase 9F-A verifies this before retaining early reservation.

### Promise-valued mutating target

Set up the private root and original version capture, install the public gate, and then fork source availability. Supported synchronous thenables may invoke transfer callbacks immediately, so all state needed by transfer/publication must exist before subscription. The callback can issue operations against its pending private root; entry does not await the source solely to begin issuance.

### Promise-valued read-only target

Read entry uses ordinary observation-path readiness and leases the reached managed value before callback execution. It preserves that logical capture while later mutation COWs. Source attribution and import ownership are unchanged.

### Pending descendants

Nested Promises do not delay entry setup or ready sibling access. They retain ordinary property versions. Pending managed method receivers are prepared only when that method consumes them. Native snapshots keep their separate ready-only rule.

## Completion and publication

Callback completion closes new issuance first. Managed read-only entry releases its captured lease. Managed mutating entry reads the latest private root's logical value: a ready root resolves the public gate immediately; a pending root subscribes through its captured Promise version and publishes after earlier private commands have advanced it in FIFO order. Subscription at callback closure is essential; do not capture the private root's eventual value before its contained commands are issued. Mark detached publication reactions handled at their origin.

The callback result is not a publication signal. A direct result may be available while selected-root publication remains pending. An independent result Promise does not extend an already-completed mutation's lifetime. Conversely, unfinished external effects promised by issued operations retain the outer reservation even if callback completion is ready. These distinct lifetimes do not justify a universal configurable gate helper.

Entered-root publication transfers the complete logical placement state, including any retained rollback baseline and original source version, through the ordinary property-version mechanism. Resolving a gate with only the visible Error would lose recovery state. Capture that state from the same latest private root at closure or deferred publication; nested transfer must not recapture the baseline from an earlier root or restore the entry-start value. Keep the Error unchanged, update any canonical namespace reference, and complete required index bookkeeping in that publication. Failure obeys ordinary publication and scope rules and preserves every required independent result Error. Fatality stops continuation work before publication and is exposed through public pending-result handling; never settle internal gates to simulate fatal cancellation.

## Ownership and import attribution

Entry into existing graph data does not reimport it. Transfer preserves category, origin, logical versions, and causal Error attribution. Copying managed ancestors preserves shared children and fixed external bindings. Root and entered Chains use the same operation API; entry adds only readonly/closed capability and its captured location/reservation ownership facts.

Managed rollback and scope poison belong to captured placement state, not shared identity metadata. Each contained managed mutation preserves its own pre-operation value; successful earlier commands remain committed if a later command fails. Entry gates access but creates no callback-wide rollback transaction. A healthy earlier snapshot does not acquire later poison, while native access still obeys canonical namespace poison. Repair reveals the preserved baseline without changing previously returned Errors.

## Composition and lifecycle constraints

Reference arguments to Cascada functions use entry and issue all reference operations through the entered Chain. Native method arguments use export and do not gain reference mutation permission. Compiler delayed-control-flow lowering chooses the smallest correct effect path and calls the public entry-target handoff for external scope boundaries. It never narrows a mixed entry simply because a bang mutation at that mixed root would be invalid.

When a Cascada call receives multiple reference arguments, the compiler must not acquire conflicting entries sequentially while holding earlier ones. Overlapping arguments share an enclosing reservation and expose relative entered references; disjoint requested branches need one synchronous reservation batch before any member awaits predecessors. This integration belongs to Phase 13 using the common capture/publish kernel; acquiring arguments in opposite orders must not deadlock or let later work overtake an earlier argument. Do not broaden disjoint arguments to a common parent if that would block unrelated siblings.

The implementation keeps one explicit owner for an issued operation, normal guarded continuations, and separate release points where source lifetimes differ. Entered external views contain only frontier state for their covered subtree. They do not duplicate managed graph publication, maintain pending-operation queues, or add execution-wide cancellation/ownership registries. Remove superseded owned-gate dependency traversal only after the nested-entry and live-guard behaviors below are preserved.

## Path errors and fatal failures

A managed path Error or own poison on a strict ancestor propagates unchanged and prevents callback invocation. An Error at the selected target does not invalidate entry; preserve its complete placement state for contained operations. A failed mutating selection follows its prescribed selected/static-prefix poison rule while preserving fixed identities; a readonly selection failure affects only its result. Gate installation grants no native mutation authority on a mixed scope. Contained repair can clear only its selected recoverable state and cannot clear a permanent identity conflict.

Unexpected runtime failures, execution mismatch, and new issuance through a closed entered Chain retain their established fatal boundaries. No special entry rejection action, contextless execution, abort method, or cleanup Promise is added. Detached publication and already-issued native work retain their existing handled-reaction obligations.

## Implementation contracts

Keep managed gate installation and completion at their natural points. Managed mutation gates only returned pending work; entry gates before callback issuance. Share property versions, path COW, and the external reservation kernel, not a helper that hides these different capture moments. Entry setup initializes its private root before a synchronous callback can observe it and completes owning-path writeback before publication can escape.

The data holder of an entered Chain has the same representation as a normal Chain. Its context provenance supplies canonical depth and first-dynamic-segment information; its reservation view supplies inherited external access coverage. Gate resolvers stay private to the entry/publication code. A read-only or closed capability is checked at common issuance boundaries; helpers do not repeat malformed-internal-control validation.

## Verification

- Enter a.x behind a slow condition and keep a.y immediately available; repeat with shared/imported ancestors and pending source versions.
- Keep old captured values independent of new gate installation, mutation, poison, and repair. Cover a direct and pending target, aliases, and COW through Array structure.
- Enter mixed managed parents for reference arguments and control flow; reject an invalid mixed bang inside the otherwise-valid entry without running native code.

- Enter an already-poisoned managed target in both modes: inspection runs, mutating repair/replacement restores normal use, and readonly mutation remains forbidden. Cover ordinary Error data without a baseline, strict-ancestor blockers, and pending delivery of target poison. Repeat through nested entry and compiler-style conditional/reference callbacks.
- Enter registered external siblings concurrently; parent entry waits for both. A child continues issuing work while a later parent reservation waits for it, with no deadlock or overtaking.
- Preserve managed ready-sibling access after parent callback closure while native child work remains pending. Preserve open nested managed and external entries after parent publication.
- Cover read-only mixed and external-root entry with observation coverage: concurrent observations proceed, conflicting mutations wait, and nested readonly capability remains enforced.
- Verify explicit native-property rejection and compiler selection of the deepest registered scope under multiple host shapes, including computed-prefix rejection.
- Keep callback Error completion, independent result Promise lifetime, scope poison, recursive repair, permanent binding conflict, and fatal pending-result delivery distinct.
