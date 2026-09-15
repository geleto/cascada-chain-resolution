# Managed and External State Architecture

## Error boundaries

All host work retains the immutable operation context that selected it. Exact host throws and direct Error outcomes are classified at that action; preparation, publication, and cleanup defects remain fatal. Complete required input collection preserves every cause/source/kind before deciding whether host work can run. Declaration validation runs outside execution and returns an ordinary native Error atomically; it creates neither poison nor fatal state. Diagnostic causes obey [data limitations](data-limitations.md#errors), so exposing a frozen poison cannot provide a protected receiver or external capability through its native cause.

Developer-facing data and external-code restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines the runtime architecture that supports that contract.

## Model

Cascada manages records and Arrays by default, so `externalState` opts an exact record or Array out of management. Class instances are external by default, so `managedState` opts in an instance and `managedStateClass` changes the default for subsequently admitted instances of an exact class. `externalState(instance)` overrides that class rule. Admission fixes one classification for the identity within each execution.

Managed state is traversed, Promise-aware, copy-on-write, and replaceable. External state remains exact host state and is observation-only by default. Phase 9 allows mutation only through the valid binding of one normalized path of one context Chain.

## Declarations

```js
externalState(value)
managedState(value)
managedStateClass(...classes)
import(value, operationContext)
```

`externalState` and `managedState` return their original value without wrapping, modifying, or admitting it. An Error value is returned unchanged and receives no declaration. `managedStateClass` returns `undefined` on success. Repeating the same declaration is harmless; a contradictory declaration returns a validation Error without changing the established mode. Declarations affect future admission and never reclassify an identity already admitted in an execution.

`externalState` applies shallowly to records, Arrays, and class instances. A Function, Promise, supported callable thenable, or primitive returns a validation Error. `managedState` declares a class instance, or every class instance currently reachable through raw managed structure. It preserves aliases and cycles and does not register encountered classes. Declared external identities, uninspectable identities, Errors, and Functions stop the walk; passing an external or uninspectable identity as the root returns a validation Error. Arrays remain managed unless explicitly declared external. Validate the complete walk and every managed-class prototype before recording anything; the prototype chain may contain unrelated accessors but no callable or accessor `then`. Declaration APIs are used before their data enters Cascada and do not inspect execution metadata. Preserve Error inputs before ordinary thenability recognition. Inability to inspect an unsupported identity returns ordinary validation and atomically records nothing, with no thenability cache, poison, Promise, synthetic thenable, or persistent capture.

A class instance added later follows its own identity declaration or exact class rule. `managedStateClass` affects only subsequently admitted instances of the supplied exact prototypes. It samples each supplied function's object prototype once, validates every prototype chain before changing the registry, and returns a validation Error if any contains a callable or accessor `then`. It does not separately probe whether a supplied function is constructible because Cascada never constructs it. Declarations never resolve a Promise or callable thenable: `externalState` returns a validation Error for one as its argument, and `managedState` does so for one anywhere in its walk. The declaration walk deduplicates reached identities for traversal only; it creates no admitted fact or cached thenability state. Inability to inspect thenability is validation failure, not rejecting thenability state.

## Classification

Keep identity declarations outside application objects and managed class prototypes in one registry. Resolve callable thenables before admission. Preserve Error and Function semantics first. An identity imported from observation-only external property state remains external, including a record or Array; a detached copy read from mutable external state is new managed data. An explicit external declaration likewise makes a record, Array, or class instance external. Otherwise Arrays retain intrinsic semantics, records default to managed, and a class instance follows its explicit managed declaration, the exact managed-class registry, or the external default. Records and Arrays passed to `managedState` are traversal roots and receive no redundant declaration.

An identity declaration selects a category but does not bind a prototype. It persists as runtime-wide configuration so every execution can apply it independently. Admission stores the category and prototype then present in that execution. Later declarations, registry changes, and prototype changes never alter those admitted facts. A managed prototype present at admission must satisfy the managed-class contract. A managed copy receives fresh execution-local metadata with the source category and prototype but no declaration entry. Ordinary import, export, graph movement, and COW keep external identities exact. A mutable-property snapshot is different: it reads external state into new managed identities and carries no external classification or authority.

## Import

`import` is the sole boundary for host data entering the language graph. It is used only for:

- a host root explicitly passed to the public `import` API, including each context root as a whole;
- every native JavaScript call result;
- every accepted controlled host-callback result that enters the graph; and
- every external-property read result.

A Promise fulfilled from one of these boundaries continues that same import; it is not another boundary case. Assignment, managed lookup, Chain transfer, and other movement within Cascada preserve admission and origin without importing again.

Public `import(value, operationContext)` creates no external mutation authority. `operationContext` carries the execution and source-error information. Ordinary Chain construction admits existing Cascada data. Root ContextChain construction uses the same importer for its raw host value and receives the compiler mutation access tree. Omission imports the context without authority discovery; `{}` requests only the root as a potential external owner. An entered Chain receives an already-admitted value and retains its originating route and reached runtime-tree node when applicable.

A synchronous scalar callback result consumed only as controlled-operation control data does not enter the graph. Validate it directly under that callback's result contract.

One importer applies the boundary's ownership policy. A synchronous segment validates its complete reached shape before committing origin, sharing, or placement versions. It traverses each new managed identity once while preserving aliases and cycles and stops at Functions, Errors, and external identities. A nested native Error remains physically unchanged while its placement receives the occurrence's contextual wrapper; equivalent newly constructed wrappers are deduplicated during collection by raw cause, source-context identity, and kind, without cross-segment interning. A new host-produced managed identity becomes imported and shared. Existing metadata in the current execution identifies an admitted result: retain it without traversing it again, preserve its origin, and mark it shared when the result adds an owner. Metadata from another execution is invisible. Managed values cross executions only through export and import. External code may independently supply exact external identities, but a mutation-capable identity must not be shared between executions because their authority and ordering state are isolated.

A complete ready or direct-Promise result passes through import once. Direct completion produces the imported value or contextual admission Error; an Error is synchronously recognizable non-thenable data and safely fulfills a pending normalized operation. A raw rejection is contextualized at that boundary unless already contextualized, then completes with the same ordinary Error outcome. Promise fulfillment continues the same import boundary for newly reached values. Imported storage retains its physical asynchronous source: an actually pending source uses a Promise version, while a custom thenable consumed synchronously uses a fixed overlay for its final logical value.

A new identity read from observation-only external property state remains external. A property read inside mutable external state copies the reached ready graph and admits every traversable copy as managed, preserving prototypes, Functions, aliases, cycles, and Array structure. An already-managed source is copied through its logical properties and Array projection. A direct host property-result Promise completes before copying; nested thenables and pending logical properties are invalid and receive no subscription. Snapshot failures affect only the observation result. The [snapshot transaction](external-context-ordering.md#snapshot-transaction) defines traversal, validation, and publication.

Managed lookup and parent retention use ordinary sharing and COW regardless of mutation paths or external children. Exact external references remain inert leaves with no authority at another location, and export rejects mutable capabilities. An external reference to managed data is read-only: a direct native call or write on that managed receiver through the external alias is rejected. External mutation is confined to the selected boundary's owned state; declare a combined native graph external before import when needed. Host methods retain ordinary result import and must return independent data or relinquish mutation of the returned managed graph. The [ownership boundary](external-context-ordering.md#managed-and-external-ownership) requires no hidden-alias index or scope-dependent importer.

## Export

Export is the sole outbound data boundary. It is used for:

- every explicit argument passed to native JavaScript, including managed, external, and native methods;
- declared inputs passed to a host callback by a runtime-controlled method;
- every value assigned to an external property;
- every script result.

Runtime-controlled methods such as supported Array methods consume logical Cascada values directly. A host callback invoked by one is a separate export boundary.

Export resolves required availability, removes runtime representations, and copies managed records, Arrays, and class instances into independent host data while preserving aliases, cycles, Array structure, and admitted prototypes. One boundary operation exports its ordered roots with one identity map, preserving aliases across input positions. It collects every required contextual Error, flattens nested compounds, and deduplicates by raw cause, source-context identity, and kind. Error order is unspecified; successful root positions remain ordered, and no Error reaches external code. A controlled operation that invokes one host callback repeatedly prepares one shared exported snapshot for those invocations. Functions and external identities remain exact. Managed receiver isolation remains a separate ready-state copy operation.

Export uses no managed source lease. Its synchronous walk copies every ready placement. Exact Promise versions preserve pending property versions whose FIFO continuations synchronously traverse each newly revealed branch once, without rereading already captured source state. External code may retain exported copies, Functions, and exact external identities, but receives no external mutation authority through export. Independent host mutation remains outside Cascada's ordering guarantees.

Completed or discarded output releases its export state without closing a containing operation. Fatal execution failure performs no owner or resource sweep: a later continuation sees fatal state first and returns before shared settlement or further export work, while a never-resumed dependency may retain dead partial export state until it becomes collectible with the execution. In a live execution, Error collection remains open until every required branch has been inspected, although it discards output copies after the first Error.

## Managed methods

Records and classes use the single boundary defined in [`managed-invocation.md`](managed-invocation.md). A record selects an own enumerable Function-valued placement; a class selects from its admitted prototype chain. Selection occurs only after complete receiver preparation and explicit-argument export. The boundary then isolates mutation state when required, invokes once, validates and publishes a mutation, and imports the result.

The caller's mode is trusted: observations do not mutate their receiver, and mutations change only their isolated receiver. Exported managed arguments are independent; exact Functions and external identities remain read-only. External identities nested in a managed receiver are opaque leaves and require a separate external Cascada operation for host access.

Receiver and argument work share one operation lifetime. One direct Promise extends it; a nested result Promise does not. Observations retain receiver leases through direct completion, mutations keep private state behind the ordinary transition gate, and common method-result import gives exact receiver/result aliases shared ownership.

## External ordering

The accepted [external ordering architecture](external-context-ordering.md) uses a static tree containing registered external parent and child scopes. Discovery follows finite named original data paths, skips thenables, preserves admitted categories, and commits locations atomically. Registration and off-path access retain the context/regular-Chain distinction; no aliases gain authority and no completed result is revoked.

Overlapping scopes conflict when either operation mutates; disjoint siblings and ordinary observations overlap. Upward completion dependencies replace child counts and subtree searches for active work. External poison lives separately at its owning node, with descendant summaries that preserve healthy sibling access. Parent queries collect complete metadata Error unions without native reflection. Repair clears the selected repairable subtree before a following call, preserving identities and permanent binding conflicts.

Managed mutation scopes exclude registered mutable external descendants. Observation-only external leaves remain permitted. An invalid mixed scope is poisoned through owner-isolated guard metadata while retaining its value. External methods cannot inspect or mutate managed storage through native aliases, and parent native methods must preserve all fixed registered child locations.

Entry may select mixed branches. It combines ordinary managed placement gates/leases and path COW with tree reservations for native descendants. Covered entry views use the same external ordering algorithm for contained commands, preserving nested work and ready managed siblings after callback closure. Native-property compiler lowering chooses the deepest registered scope; it does not narrow managed/mixed targets or grant bang authority.

Method-result import remains nonblocking for nested Promises, including already-managed borrowed results read through logical versions. Mutable native property snapshots remain a separate ready-only copy boundary. No raw managed data becomes native-writable merely because it is reachable beneath a bang or an entry.

## Scope

Managed records and classes share one invocation instead of using a record-specific path. The architecture reuses one import boundary, one export boundary, and ordinary managed COW, leases, gates, versions, and publication. External ordering adds a fixed runtime tree when filtering the compiler mutation access tree finds external boundaries, one execution identity map, and the common readers-writer phase mechanism; it adds no hidden Chain, live external graph, special importer, or second invocation coordinator.
