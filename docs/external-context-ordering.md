# External Context Ordering Architecture

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines the ordering and authority architecture behind them.

The authority policy below incorporates the agreed context/regular-Chain distinction: invalid off-path access fails locally, while competing independent context registrations invalidate shared authority. No earlier placement or completed output is rewritten. Distinct candidate paths to the same external identity within one root context are forbidden and fail import before registration commits.

Phase 9E and its [completion addendum](first-principles-conformance-plan.md#completion-addendum-implementation-and-verification) implement atomic registration, compiler-guided discovery, canonical boundary records, and single-owner coordination with direct poison completion. Phase 9E-A updates Error unions and graph summaries next. Phase 9F connects public external calls, property access, repair, scope metadata queries, binding-entry gates, and the fixed mutable namespace to that kernel and implements snapshots. Phase 13 emits the compiler input and consumes the public routing handoff.

## Model

External values are exact host identities and are observation-only by default. Cascada may mutate an identity only when its boundary was directly accessible along a compiler-selected mutation access route in the original context data and every actual use follows one normalized path of one context Chain. Import, storage, copying, and return are not uses.

Managed state uses COW, leases, and transition gates. Mutation-eligible external state uses one readers-writer phase per exact identity. External mutation changes that identity in place. A direct operation Promise retains the phase through boundary completion; a nested result Promise does not.

An external boundary is a context root or the first external identity reached from managed state. It guards the host suffix below that identity for one operation. Cascada never scans an external graph or compares its hidden descendants for aliases.

Only mutation-capable boundaries have fixed paths and ordered phases. Selecting one requires its static source path; a computed key before the boundary is invalid even when ready. Dynamic native-suffix keys remain valid after that first owner is statically selected. Observation-only external identities remain unlocked and can occur on dynamic, replaceable managed paths.

Runtime tree leaves identify first external boundaries. Compiler routes describe potential mutation access independently of the operation's poison scope; a managed `!` scope contributes no subtree search or scope marker. Every recorded boundary path is static and directly accessible in the original context. The operation's native suffix may still contain dynamic input keys.

The constructor accepts one compiler-owned mutation access tree whose nodes are property maps, including `{}` endpoints. Its edges contain only source-static keys; actual operations retain their separate `firstDynamicSegment` fact. [Compiler construction rules](integration.md#compiler-construction-of-the-mutation-access-tree) define path selection, merging, root requests, and ownership.

For an actual mutable-resource access, compare the first computed-segment position with the reached boundary depth, in the same canonical path coordinates: `firstDynamicSegment >= boundaryDepth`. The bang's position does not replace that check. `api![name].write()` has a static bang prefix but cannot dynamically select a registered child resource. Conversely, `api.db[name]!.write()` may select a static external `api.db` and use `name` only within its native suffix. Carry the source fact through observations and entries too, without deriving it from resolved segment values.

Forbidden dynamic observation returns local `ExternalLocationConflict` validation poison before native access. A forbidden mutation poisons an already-selected managed `!` scope, or the longest static managed prefix if the intended scope lies beyond the first dynamic key. Preserve this failure location independently of detection timing; do not reserve or poison candidate resources. A blocked prefix returns its original poison instead. Path capture retains the compiler's first-dynamic-segment fact because resolved keys alone cannot prove staticness.

## Static external mutation tree

`ContextChain(initialValue, operationContext, mutationAccessTree = undefined)` imports its raw host root and filters the compiler tree during the initial synchronous import transaction. The compiler supplies potential mutation access routes without knowing host categories. It retains ownership of the input, which the kernel neither modifies nor retains after construction. Build the context-local runtime tree directly while filtering; no preliminary deep copy or second request trie is needed. Omission means no requests; `{}` requests only the context root. The complete compiler contract lives in [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree).

At every requested node, use staged/admitted category facts and the original source value:

- A first external identity becomes a runtime boundary record. Stop immediately, without reading requested native descendants. An internal compiler node can therefore become a runtime leaf.
- A managed container follows only the compiler node's own requested keys, using ordinary language placement descriptors. A managed endpoint produces no record. Prune every connecting branch whose children all disappear.
- Missing placements, primitives, Errors, and Functions produce no record. Every Promise or thenable stops discovery, even when fulfilled or synchronously delivering; its imported outcome never supplies a boundary.

Ordinary import still consumes thenables and inspects each newly admitted managed identity once. Authority discovery follows finite compiler-tree occurrences through original inputs, including already-admitted containers. It neither enumerates a selected managed subtree nor reclassifies an admitted identity. Context cycles need no special discovery handling: each recursive step consumes an edge of the finite compiler tree. Distinct explicitly requested paths through an alias or cycle remain distinct locations. Work and allocation are bounded by those requested occurrences and produced runtime paths/records.

Stage each discovered exact identity and its new location record locally. A second distinct location for that identity fails the complete import segment with `ExternalLocationConflict`; merged compiler prefixes already represent one normalized request. Stop at the first external boundary, so several requested native suffixes under one owner produce only one location. Inert aliases outside the compiler tree and thenable-only routes do not register. A supported reflection failure likewise commits none of the segment's admission, sharing, placement versions, tree, or registrations. Abandoned subscriptions cannot later admit or publish. Only the otherwise-valid import commit may create identity entries or invalidate an existing binding.

### Runtime nodes and identity validation

Runtime branches are own String-keyed child maps, built with safe own-property storage. Runtime leaves are immutable external location records. One internal Symbol, `EXTERNAL_BOUNDARY`, identifies a leaf and holds its execution-local identity entry:

```js
{
    [EXTERNAL_BOUNDARY]: identityEntry,
    path: canonicalPath,
    context: originatingContext,
}
```

`path` is the immutable canonical path from the originating root ContextChain; `context` anchors live ancestor guards and binding-entry ordering there. Entered Chains retain their originating context and canonical route as needed by public traversal, and select the same location record. They create no registration or copied subtree. Branch property names such as `path`, `context`, `constructor`, and `__proto__` remain ordinary child keys; inspect the Symbol before interpreting any location fields.

The leaf record itself is the binding location. A valid identity entry's `binding` points to that record; conflict replaces only the entry's binding with its immutable Error. There is no additional boundary wrapper, location token, class discriminator, Boolean external flag, or separate copy of the entry reference. No runtime node contains both a boundary and native child nodes. The Symbol is internal representation, never a compiler input or public authority API.

Store no receiver or duplicate external object reference on a node. A method receiver is operation-local and may differ from its fixed external owner; managed COW and native property changes can change receivers. At an actual boundary crossing, look up the reached value in the execution's identity map and compare that entry with the leaf's `EXTERNAL_BOUNDARY` entry. A mismatch is the existing fatal fixed-identity violation. Then validate current binding authority. Metadata queries and deferred authority rechecks use the leaf's entry directly without reading native properties or reconstructing a receiver.

For an external `api`, `api.reset()` and `api.db.write()` use the same `api` boundary and phase, even when `db` is their native receiver suffix. If an ordered mutation replaces the owned native `db` property, subsequent access selects its new value after the predecessor completes; the tree remains unchanged. For a managed `api` containing separately external `db` and `config`, only those children have external records. A managed method on `api` uses ordinary managed rules, including the fixed-namespace restriction on arbitrary managed mutation. No receiver-used flag or nested independent boundary is introduced.

The runtime index remains fixed after commit. It contains external boundaries and their managed connecting paths only. Promise delivery, COW, assignment, deletion, Array remapping, and entry neither add nor move locations. Registered boundaries and their ancestors form the originating context's fixed namespace: reject whole replacement/deletion, structural remapping, and arbitrary managed mutating receivers that include it before effects. Ordinary managed children beside that namespace remain mutable. Poison and entry gates preserve the underlying binding; observation-only external identities impose no fixed-namespace restriction.

Tree queries return recorded leaves even after their shared binding becomes invalid. Explicit access and contextual Error inspection must see that binding Error; authority validation belongs to the selected operation. No conflict-driven pruning, reverse leaf index, or cleanup scan is needed. Ordinary operation lookup stops at the first boundary and returns its record for any native suffix; exact entry selection accepts only the boundary itself. Ancestor queries enumerate recorded descendant leaves without traversing native state. Previously issued operations keep their captured phases and values; deferred native access checks current authority before starting host work.

Check namespace intersection once at common mutation selection, using only the affected runtime-tree route. Managed prefixes keep ordinary leases, gates, versions, and COW. A wider managed poison scope supplies its managed transition while the reached external owner supplies the native phase; neither grants mutation authority over another owner's state.

## Identity binding map

One execution-scoped `WeakMap` accounts for every external identity registered in a static tree, including later references to it from regular Chains. The entry owns two semantic facts:

- `binding`: the context registration and its single-location authority, or an immutable `ExternalLocationConflict` Error once incompatible independent contexts have registered;
- `phase`: the readers-writer cursor whose exclusive completion Promise fulfills directly with `null` or the exact repairable poison.

Do not retain a separate permanent-use history, conflict Boolean, cached current-poison field, reverse placement list, or execution-wide observation registry. Ordinary storage/admission on a regular Chain is not a registration and cannot disqualify a later legitimate context. Error creation uses the importing context that discovers the incompatible registration; selection of that diagnostic source may depend on import timing as documented in `data-limitations.md`.

Context registration is part of the otherwise-valid synchronous import commit. Stage every proposed registration until the complete segment validates; an abandoned import changes no existing binding. A successfully committed competing registration invalidates the shared authority for both contexts. The context objects themselves may remain successfully imported with an unusable capability: neither graph root is retrospectively replaced with Error data and an earlier import result is never revoked. Registration failure is stored in the shared binding, not in repairable phase poison. No asynchronous import-order arbitration or permanent first-arrival winner is introduced.

| Reached state | External operation outcome |
| --- | --- |
| No context registration | Ordinary observation-only external behavior; no mutation authority |
| Valid binding, correct registered context location | Use the ordinary selected external phase |
| Valid binding, regular Chain or another unregistered location | Return an operation-local Error before host access; preserve the context binding and its phase poison |
| Invalid binding from competing context registrations | Return the shared binding Error from access through either context; perform no new host access |

Import, storage, managed assignment, copying, and return create no external-use permission. A direct lookup that would expose a mutation-capable identity fails locally. Through its valid contextual location it still uses the ordinary observation phase so it cannot overtake earlier mutation or miss predecessor poison; export rejects the capability without acquiring authority. A regular Chain cannot turn an observational mode into permission to inspect a registered mutation-capable identity elsewhere.

One operation-local external coordinator owns one actual boundary and phase handle. A native action never selects multiple owners. Contextual Error queries compose per-boundary metadata observations through their existing query owner. Validate the route and binding before reservation and revalidate current authority before deferred native access. Add no candidate map, provisional mode, whole-selection aggregate, or second scheduler.

Already-invoked external code cannot be interrupted by later registration. Its established boundary processing and rejection ownership still finish normally; ordinary output validation applies, and later runtime accesses consult current authority. Completed results and exact references already delivered to external code cannot be recalled. Such off-path use of an identity intended for contextual mutation violates the host contract even when its future registration was not yet knowable.

Ordinary repair clears operation poison only. It does not clear invalid authority, choose a winner, withdraw a registration, or transfer a binding. Different executions do not coordinate registrations; sharing one mutable resource across them remains unsupported.

## Routing and capture points

Route by the owning placement, selected mutation scope, and first external boundary, not by the final result's category or a mutation Boolean alone. Consult the fixed tree before choosing scope protection or entering native storage. Managed prefixes retain ordinary logical reads and earlier gates; the tree identifies a boundary but does not permit bypassing those gates.

- A mutation scoped to an external boundary only reads its managed access prefix. Do not COW or rewrite that prefix merely to locate the native receiver. Once reached, its exclusive external phase orders the effect and owns poison. Ordinary prefix-failure publication still applies when path access fails before reaching that scope; observational prefix traversal must not turn such a mutation failure into a discarded local result.
- A managed mutation scope enclosing an external effect needs both its ordinary managed scope transition and the selected child's external phase. Install any required managed scope gate before waiting for external completion, and publish managed scope poison before releasing the child phase. The operation does not wait on its own publication gate.
- An observation inside mutable external state reserves a read phase before consuming a potentially pending native-suffix key or awaiting action inputs. The final value may be a primitive or managed snapshot; that does not turn access to its native source into a managed observation. Keep the phase through required boundary completion. Ordinary observations overlap through a read group; they do not install exclusive entry gates or managed leases on the native identity.
- Assignment and deletion select the owner of the final property without reading its old value. Replacing a managed binding that holds an external identity is a managed structural operation, subject to the fixed namespace restriction; writing a property inside that identity is a whole-owner external mutation.
- Entry selects the correct managed placement or whole external binding before acquiring a lease, installing its gate, or invoking the callback. A lease on a managed parent preserves only its managed snapshot and cannot order deferred native descendant access.
- Contextual Error queries capture each required external metadata observation at its path's ordering position. An unrelated pending managed branch must not delay reservation for an already accessible external scope and allow later mutation or repair to overtake that query. Earlier guards and gates still control each branch, and short-circuit queries acquire no unnecessary observations.

Before reaching a mutable boundary, an original Promise or computed key cannot defer a valid resource selection: discovery and static-path rules exclude those routes. Runtime-installed managed or entry gates can still delay a valid static route. Wait at those existing gates before reserving the external phase, then reserve before any wait in the native suffix. Observation-only external identities need no such phase; their ready-only native traversal and boundary processing still differ from managed graph traversal.

These are local routing and capture points, not separate end-to-end path engines. Reuse managed traversal, scope publication, and external preparation. An earlier entered Chain retains its managed snapshot, but external preparation must still honor current canonical ancestor guards and the ownership of private entry gates.

## External phases

For each external identity, operations follow issuance order:

- Each observation waits for previous mutations.
- Each mutation waits for previous observations and mutations.
- Subsequent observations need not wait for each other.

Repair uses the same exclusive ordering as mutation. A read group collects the observations issued between two mutations so the next mutation can wait for all of them through one completion Promise. Each observation waits only for the preceding mutation, so observations in the group can overlap.

Reserve these dependencies when issuing an operation, before waiting:

```text
observation:
  predecessor = latest exclusive completion
  join or create the current read group

mutation or repair:
  predecessor = latest exclusive completion
  also wait for the current read group to drain
  become the new exclusive operation
  seal the current read group
```

Property mutation is whole-owner mutation. For resource.a = pendingValue, reserve the exclusive phase before waiting for the input, finish its complete export, and perform the native write before releasing the phase. Later operations on resource.b wait at that same owner even though the properties differ. Observations issued between mutations share the normal read group. Never install a Promise version or gate in native storage; a non-blocking assignment return does not release the phase.

The next mutation seals the group: no further observations can join it. The group completes once sealed and all its observations have finished. Until sealing, it remains joinable even when its current observations are done. The group tracks completion only and carries no Errors. An exclusive successor waits for both the preceding exclusive completion and the drained group; poison comes only from the former. The implementation stores the latest exclusive completion and an optional read group, using native Promises for both.

Reach an external boundary through earlier managed transitions before reserving its phase. A pending ancestor gate already orders all valid access to that fixed location; queue the continuation there, then reserve the phase at its FIFO turn. Reserving first could make an outside operation hold a phase needed by work inside the entry whose gate it awaits. This rule applies to observation, mutation, repair, and entered Chains.

At that ordering position, reserve the one actual owner and publish its successor before subscribing to its predecessor. Capture explicit inputs at operation issuance even when receiver traversal must wait behind a managed gate.

A mutable boundary must be selected through a static source path. Reserve its ordinary access phase before waiting for any dynamic input key in its native suffix. Dynamic selection before that boundary is invalid and reserves no candidate phase. Observation-only external paths remain unlocked.

Managed prefix and binding-entry gates precede descendant external phases. Already-reserved predecessor work retains its captured path turn and never waits for a later entry gate; deferred binding validation does not restart path capture. Each actual access reserves at its captured path's FIFO turn, so an outside operation cannot hold a phase needed by work inside the entry whose gate it awaits. Queries compose only the scope observations their accessible frontier requires.

Capture ready managed property versions and any ready external boundary through the ordinary path walk. Input preparation and selected external predecessors may settle concurrently. Host reflection begins only after both complete. Once external reservation starts for a reached boundary, an unrelated later-revealed identity cannot acquire another phase.

`run` protects raw managed arguments itself after dispatch. Synchronous issuance is sufficient: the producing lookup has captured and shared its logical result before the consuming `run`, and selected preparation uses ordinary COW, leases, and property versions. Host-input export rejects mutation-capable external identities, so arguments need no lookup provenance or external phase.

An identity with no context registration needs no external phase for ordinary observation. An identity with an invalid shared binding returns its Error before host access; it must never be reinterpreted as freely observable merely because no leaf is currently authoritative. Exact external identities use phases, not managed leases or transition gates; a managed prefix may independently require its ordinary lease or gate.

## Mutation scopes

`!` selects a mutation scope. If the scope is external, select that exact boundary and clamp any deeper host suffix to it. If the scope is managed, use the ordinary managed transition at that prefix; an external host operation selects its reached first external boundary only. A managed method never receives authority over its opaque external descendants, and an external method never receives raw mutation access to managed ancestors or siblings.

For example, with managed `apis` containing external `db` and `cache`:

- `apis.db!.write()` selects `db`.
- `apis!.db.refresh()` uses managed mutation handling for `apis` and selects `db` for the external effect. It does not authorize mutation of managed `apis` data or a separately owned `cache`.
- If `apis` itself is external, both forms select only `apis`; its suffix is opaque.

The selected mutation scope also owns the operation's poison. If the scope is managed and must retain fixed external bindings, preserve its underlying value and publish poison in that scope's metadata. For `api.managedContainer!.externalApi.someCall()`, failure poisons `managedContainer` only. The external child's phase still orders the native call but receives no additional poison for this failure. A marker at or inside the external boundary instead makes that boundary's phase the poison owner. Ordinary managed scopes without fixed external bindings retain their normal Error-value publication.

External code may mutate only state owned by its selected authoritative boundary. Hidden writable aliases to managed data or another external owner violate the host contract, even when reachable through the receiver. Declare a combined native resource external before import when its methods need to mutate that complete owned graph. An invalid or unselected boundary grants no authority; explicit access to invalid authority returns its binding Error.

## Entered branches

A managed mutating entry uses its ordinary branch gate. Entry at a mutable external boundary is likewise a whole-resource exclusive control-flow scope: install the ordinary gate on its contextual binding, even if its callback only observes. This gate protects the binding and issuance order, not native storage. The private Chain retains the exact external identity; it gains no managed copy or native-property writeback. Outside access waits at the binding gate before reserving external phases, while contained commands reserve their normal phases. Entry holds no external phase across its callback. After callback issuance closes, publish the same binding; already-issued native work stays ordered through its existing phases.

`enter` carries the source execution and reached canonical tree node through an ordinary Chain. Its own private work bypasses only its own binding gate; earlier entered Chains and outside routes obey the current gate. Retain phase poison so an inner explicit repair remains possible. Root replacement on an entered mutable external identity is forbidden; normal property operations act on its native suffix under authority. Read-only capability restrictions still prevent mutations, even when the entry uses exclusive binding protection. Observation-only external entry acquires no mutable-resource lock.

Live entry into mutable external state selects the whole first external boundary through a static path, never one of its native properties. Compiler lowering chooses that whole resource for a conditional child write. Runtime target selection rejects a native-child entry with PropertyValidation poison, before any child reflection, gate installation, or callback. This explicit recoverable classification also applies when an incorrect compiler lowering produced the request. Respect earlier guards and phase predecessors: preserve existing poison, otherwise a mutating entry failure poisons the external scope and a read-only entry failure remains local. Preserve the resource binding and never silently retarget the request. Compiler mutation paths themselves provide no host-category knowledge; the actual first boundary comes from initial import.

## Poison and repair

Each exclusive phase retains one completion Promise whose fulfillment carries the hook-free state record. A read group supplies only a drain signal. Consumers subscribe through the common helper, preserving FIFO delivery even across settlement; there is no alternate direct-record path or phase-membership probe that bypasses queued phase work. Native completion Promises can leave the consuming operation pending even when the predecessor has settled. If an existing supported sync-first completion primitive is used, direct delivery must come from that primitive's own FIFO contract. Do not add a separate ready shortcut, queued-work tracker, or second subscriber queue to external coordination.

Phase completions order work and carry current poison. Recoverable script failure derives only from poisoned returned data. Repair and fresh replacement may remove poison, and no separate mutation-result check restores an Error that the data flow has removed. A mutation's required poison effect must therefore be defined at its related graph placement or authorized external phase, independently of whether its immediate kernel result is used.

Each failed mutation has one selected poison owner. An external scope stores poison in its execution-scoped phase record; a managed scope retaining fixed external bindings stores it in scope metadata while retaining its underlying managed value. Neither case writes poison into native external storage. Keep the managed guard at its owning context placement, not on an identity shared with another managed owner. Captured managed values retain their ordinary version/COW guarantees.

The managed guard is logical poison: subsequent operations cannot pass it, and lookup, Error queries, and export observe its Error rather than its retained contents. Preserve ordinary captured Error results after later repair; the guard must not make old outputs mutable. Hidden retained contents are recovery state, not a second graph/query frontier. Existing poison propagates unchanged and does not poison a newly attempted descendant scope. Required input collection keeps its normal contract without changing the blocking guard's Error.

Every contextual route to an external child must obey current ancestor scope guards. This includes operations issued later through an earlier entered Chain: its captured managed value grants no permission to bypass current authority, ancestor ordering, or poison. Ordinary copied aliases already have no external authority. Carry the relevant canonical scope guards through entry and consult them in common external-access preparation, without rereading an old managed snapshot as live authority. Use one authoritative guard record at its context path, referenced by the required runtime representations; do not duplicate poison across child phases or build an alias index. The originating entry's own private work still uses its existing gate ownership; outside or earlier captured entries cannot bypass a later ancestor transition.

Native external storage is not a language Error-value container. A write whose exported input contains poison performs no native assignment and poisons its selected mutation scope. The default property scope inside native state clamps to that external boundary; an explicit managed ancestor instead owns the poison. Preserve the exact external object and its fixed binding so repair remains possible. An observation that reads a native Error produces a poisoned language result but adds no scope poison; native diagnostic Errors inside opaque state require no scan or rewriting.

Each exclusive completion fulfills directly with `null` for healthy state or the exact `PoisonError`/`CompoundPoisonError`. These Errors are already non-thenable; no completion payload wrapper is needed. The read-group completion is only a drain signal, with no poison payload. These completions do not reject; potentially rejecting derived reactions retain ordinary rejection ownership. Fatal Error creates no phase outcome or cancellation path. A successor that resumes after fatal stops at its common execution check before host work.

Every observation consumes applicable scope and predecessor poison and preserves it unchanged. Any new observation Error, including a getter throw, rejected result, snapshot validation failure, or reached managed reference that cannot be copied, affects only that operation's result. Complete required Error collection before releasing the observation. A normal mutation publishes its required combined failure to the selected poison owner only. When that owner is managed, publish its guard before completing the selected external phase with unchanged predecessor poison, so a resumed successor cannot miss the ancestor failure. Completed host effects are not rolled back. A read group neither accumulates observation failures nor transmits them to a later mutation.

Native mutation authority and poison ownership serve different purposes. An external mutation ordered under a managed scope does not make the child phase its poison owner. The caller publishes the effect at the selected scope and supplies only phase-owned failure to external completion. Observations, unauthorized work, and managed-scope-owned failure relay the child's predecessor poison unchanged. Only repair clears scope poison; a location conflict remains unrepairable.

Repair-only orders at the selected managed guard or external boundary, bypasses and clears that scope's poison, performs no host access, and returns `undefined`. Repairing a managed guard makes its retained value available again; repairing an external phase leaves native effects as they are. Repair-and-call bypasses only its selected scope's old poison, invokes one selected method, then clears that scope on success or publishes the new failure there. These are the only repair forms. Repair never changes registration, clears a binding conflict, creates a tree leaf, transfers authority, or sweeps descendant poison. An independently preexisting child poison remains until that child is explicitly repaired. A poisoned ancestor must be repaired before an operation can reach a deeper repair target.

Assignment replaces, and deletion removes, an ordinary Error value at the final managed graph placement. A retained managed-scope guard and external-phase poison instead block ordinary operations until explicit repair. This preserves fixed native bindings without treating their retained data as a healthy result or adding a separate script-level failure channel.

## Host boundary

Contextual Error queries observe scope metadata, not native interiors. At an accessible mutable external boundary, capture an observation phase at the query's ordering position and read its predecessor poison. Healthy state yields `false`/`null`; poison yields `true`/the exact Error for `hasError`/`getErrors`. A binding conflict likewise remains an Error. An ancestor query includes every accessible required descendant scope, using the static tree alongside its managed Error frontier; zero managed counters cannot prune those locations. Capture each reached phase through earlier gates, and retain all required observations for complete collection. `hasError` may close once its answer is proved while owned phase completion still releases normally.

A poisoned managed guard terminates that query branch. Its retained children are recovery state, not another collection frontier; do not inspect or await them. Collect accessible siblings normally. Native opaque state, including host diagnostic Errors, is never traversed by these queries. Ordinary aliases gain no live external-query authority, and old query results do not change when a scope is repaired. Keep phase poison in its existing ordered execution-local metadata, without a second managed counter copy or error history.

External property access and calls operate on exact host state. Observation-only property reads and call results use ordinary import. A property read inside mutable external state uses a dedicated synchronous snapshot walk with the same visible copy semantics as export. It may share low-level container creation, enumerable-key reading, and safe property-definition helpers, but it does not invoke or parameterize export. A direct property-result Promise completes before copying; the copy walk rejects nested Promises. Every explicit argument and property-write value is exported. A native setter completes synchronously.

After crossing the first external boundary, traverse native properties synchronously once the selected predecessors and explicit inputs are ready. An intermediate supported thenable is invalid path data: do not subscribe, await its fulfillment, or continue through it as a managed Promise version. Method receivers and selected callables must likewise be ready. Only the final lookup value or direct invocation result may be consumed for availability; a final property Promise retains the phase through delivery and snapshotting. Snapshot only the selected final value, whose nested data must be ready. An admitted managed source reached through this route follows the same ready-only restriction.

Ordinary native property operations remain supported. Lookup copies its selected result inside mutable external state; assignment exports its new value and performs the native write; deletion performs native deletion. Final write/delete never read the old target. Thus `x.promiseProperty = value` and `delete x.promiseProperty` are valid under authority, while `x.promiseProperty.y = value` is invalid. Replacing a Promise-valued property does not consume its old Promise or its later rejection.

Public `import(value, operationContext)` never creates a static tree or external mutation authority. An unregistered identity remains observation-only; an already registered identity keeps its existing binding restrictions. Importing an alias cannot downgrade authority checks. Only initial `ContextChain` import can establish possible authority.

An external operation follows the common lifecycle:

1. Validate operation inputs and perform ready hook-free internal dispatch.
2. Capture explicit inputs and traverse the managed prefix through captured versions and earlier gates. Validate static mutable-resource selection against the tree; a forbidden dynamic route fails through its predetermined local scope.
3. Reserve the actual mutable boundary at its managed-path ordering position, publishing its successor before waiting on its predecessor or a dynamic native suffix key. Observation-only external state needs no mutation phase.
4. Wait for the selected boundary's captured predecessor and required path readiness, then validate its current binding before host access. A blocking poison skips action-only preparation and propagates unchanged.
5. Finish required preparation and Error collection. Reservation does not create or modify a binding.
6. If preparation or conflict failed, perform no host reflection; otherwise traverse the host suffix and invoke the selected callable exactly once.
7. Import the result or finish its snapshot, publish mutation poison or repair, complete any managed scope, and complete exclusive records or observation drain signals.

A locally closed continuation in a live execution completes shared settlement but performs no later host access or publication. A continuation in a fatally failed execution returns at the execution check before settlement. External code must not synchronously re-enter the same execution; a separate execution remains independent. Independent work in the original execution may start after the synchronous host call returns with its own explicit operation context, but a direct host Promise must not depend on work ordered behind the call's active managed gate or external phase; such a dependency cycle is invalid host behavior. External identities reached below a selected boundary gain no tree leaf or independent mutation authority. A property read inside mutable external state returns a detached managed snapshot; observation-only external-property results and call results use ordinary import.

## Managed and external ownership

Managed data retains ordinary sharing, leases, property versions, indexes, and COW, including under a `!` prefix or in a parent containing external objects. An external method may mutate only state owned by its selected first external boundary. A reference through `this`, a parent link, or a closure grants no permission to mutate an admitted managed identity or another independent external owner. The restriction is about ownership, not syntactic reachability; hidden violations remain a host contract rather than requiring an alias scan.

A managed lookup or retained parent needs no extra copy or external phase merely because its subtree contains an external identity or a compiler mutation path. Ordinary managed gates still order unfinished managed transitions. Exact external references remain opaque and inert through managed sharing and COW; using one through an unregistered location fails, while native export rejects a mutable capability. Managed operations never inspect an external interior to retain its parent.

An explicitly external record may own both plain data and native services. That complete owned region uses one external boundary: native methods and property writes run under its phase, and mutable property observations return detached managed snapshots. Its live contents have no managed COW, property versions, or graph indexes. A declared external owner is chosen before admission; an external child or `!` does not automatically promote a managed parent. Distinct external owners must not share writable native storage.

Neither observations nor mutations may read another mutable owner's hidden state without its ordering. Combining state under one owner or passing detached results supplies that dependency explicitly. Read-only managed source references remain permitted because their original storage is protected; native access does not follow later managed COW updates. No hidden-reference registry or scan is added.

Ordinary import preserves managed identity aliases and cycles. It does not normalize them by mutation scope or turn an admitted identity into a native-writable source. Host-method results follow ordinary import: hosts return independent data or relinquish mutation of the returned managed graph. A shallow new container does not make shared descendants independent. The external property snapshot below provides the copy when reading mutable external data, including an existing read-only reference to managed data.

## Snapshot transaction

The transaction in this section copies a property result read inside a registered mutable external boundary. Ordinary managed lookup and parent retention use sharing and COW; they do not invoke this transaction. A snapshot grants no external mutation authority.

Snapshotting an external property separates the returned data from its source. It does not remove native references to the source or grant permission to mutate already-managed storage. Managed ownership follows the original identity: host code must leave every admitted managed identity unchanged even when reachable beneath `!`. Data that external methods will continue mutating must remain external, or the host must return a detached copy when crossing an ordinary result-import boundary. Snapshot work is bounded to the selected result graph; there is no opaque-resource clone or scan of native hidden state. Managed aliases elsewhere retain ordinary import and COW behavior.

After phase predecessors and ordinary preparation complete, traverse only the selected property path. Do not read external properties or select a method before that wait. While selecting the explicit path, validate any reached registered external identity against its exact authority before inspecting it; an off-path boundary returns its location Error and grants no additional authority or phase. Once copying the selected result, any registered mutable identity is an `ExternalCapabilityEscape` leaf and is not traversed. Reading the selected boundary itself as a value, or reaching it again inside a snapshot cycle, returns `ExternalCapabilityEscape` rather than cloning the capability.

Use current execution metadata to choose how to read a reached source. Unmanaged host state uses the existing external property/reflection boundary. An admitted managed identity uses `language-properties.js` for presence, keys, and logical values, `array-view.js` for Array length, holes, and projections, and its admitted prototype for copy construction. This selection applies during the explicit property-only suffix and at every snapshot node. It does not admit or reclassify the source. Do not reflect the physical target behind an ArrayView, read a stale host Promise in place of a ready logical version, or invoke managed accessors as language data.

A managed reference reached through an external property is a data-read route, not a managed mutation placement or a native-call receiver. A direct native invocation on that managed receiver fails with `InvocationFailed`; a write/delete targeting its managed storage fails with `UnsupportedMutation`, before native action. The user can read a detached snapshot and call its managed methods normally, or use the original managed path. An outer native method may retain a read-only reference to managed data under the host contract, but must not mutate it through hidden code. These checks use already-reached metadata only; they introduce no native alias scan or alternate managed writeback path.

A direct host property-result Promise is consumed once through the common boundary helper, retaining the observation phase until the selected result and its snapshot complete. Once traversal reaches managed source data, required logical properties must already be ready. The snapshot walk itself is synchronous and never awaits a nested source: a supported thenable, unresolved logical placement, or managed transition gate returns `InvalidExternalSnapshot` without subscription. This includes a synchronously delivering nested thenable. A ready value in a placement version is copied as ready data even if the physical property still holds its old Promise. No queued Promise reaction is bypassed to obtain a ready value. Ordinary managed lookup/export remain the routes for consuming pending managed graphs; an external snapshot does not wait on a gate that might depend on its own phase.

Walk only the selected output graph, with one transaction-local identity map and one Error accumulator. Register a fresh copy before visiting its children so aliases and cycles across host and managed portions resolve to the same output identities. Copy every traversable node; do not share a managed source merely because it is already admitted. Preserve logical Arrays, own enumerable String-keyed properties, admitted or supported source prototypes, and exact Functions under their existing host contract. Reject another registered mutable identity before copying or exposing it. An uncopyable opaque value is `InvalidExternalSnapshot`; there is no generic opaque-object clone or exact-reference fallback from a mutable snapshot.

Use existing output-container construction and safe own-property definition where their semantics match. Keep source reading at its proper boundary; do not turn export into a configurable walker. Supported host reflection failure is `ExternalPropertyReadFailed`; invalid snapshot shape or nested availability is `InvalidExternalSnapshot`; propagated poison preserves its identity, cause, source, and kind. Internal invariant failure is fatal. Runtime-created reasons never embed protected source identities.

A recoverable Error discards partial output but does not stop collection through other required enumerable properties and selected roots. Continue through the synchronously discoverable frontier with the same visited map, collecting all distinct Errors; do not subscribe to invalid nested thenables or invent children after an enumeration failure. Preserve complete semantic Error membership with unspecified ordering. No observation failure changes phase poison.

Validate copied prototypes, native `then` safety, and supported managed-class shape before committing admission for the completed output graph. Reuse segment-local staging discipline; on failure publish no partial output and commit no output admission. Source admission, sharing, versions, external bindings, and phase poison are unchanged. The synchronous transition that completes copying or Error collection then releases the observation reservation. There is no pending snapshot owner, source lease, or additional gate; only the direct host result can retain asynchronous boundary work.

## Scope

External ordering uses a static tree of discovered external boundaries and their parents, plus one identity binding-and-phase map per execution. It reuses import, export, invocation, readers-writer phases, operation lifetime, managed COW, leases, gates, versions, and publication. Managed ownership needs no separate scope tree or native-writable representation.

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

Initial context import rejects discovery of one exact external identity at two distinct normalized compiler-selected boundary paths with an import-attributed `ExternalLocationConflict`. For `{ a: resource, b: resource }`, the compiler tree `{ a: {}, b: {} }` is invalid when both values identify the same external resource; `{ a: {} }` makes no claim through the inert `b` alias. Explicit finite routes through managed aliases or cycles obey the same rule. Merged compiler prefixes and native suffixes beneath one first boundary produce only one location. Entered contextual Chains retain that original record and create no registration.

Validate uniqueness in the existing staged discovery, using its import-local identity-to-location proposals. A second distinct location fails the complete initial segment before any admission, overlay, tree, or registration commits; pending callbacks from that abandoned segment cannot publish later. Existing bindings remain unchanged even if the rejected import also proposed a competing independent-context registration. Only otherwise-valid independent context imports can invalidate shared authority. The committed binding needs one location, with no candidate set, first-use selection, or path arbitration.

Discovery is bounded to the compiler tree's finite requested occurrences in the original directly accessible context. Inert aliases outside those routes, including thenable-only routes, create no duplicate locations. Future off-path use fails locally. Delivery never adds a leaf, including synchronous custom delivery.

Verification must cover duplicate-path rejection and rollback, permute context/context and context/regular import order, distinguish inert storage from pending and completed access, include already-exposed exact references, and preserve normal FIFO ordering and immutable results for supported single-location programs. No test should expect retroactive failure of a settled result.
