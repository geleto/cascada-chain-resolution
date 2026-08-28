# Managed and External State Architecture

Developer-facing data and host-code restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines the runtime architecture that supports that contract.

## Model

Cascada manages records and Arrays by default, so `externalState` opts an exact record or Array out of management. Class instances are external by default, so `managedState` opts in an instance and `managedStateClass` changes the default for subsequently admitted instances of an exact class. `externalState(instance)` overrides that class rule. Admission then fixes one classification for the identity.

Managed state is traversed, Promise-aware, copy-on-write, and replaceable. External state remains exact host state and is observation-only by default. Phase 9 allows mutation only after actual use through one compiler-static path of one context Chain.

## Declarations

```js
externalState(value)
managedState(value)
managedStateClass(...classes)
import(value, errorContext)
```

`externalState` and `managedState` return their original value without wrapping, modifying, or admitting it. An Error value is returned unchanged and receives no declaration. `managedStateClass` returns `undefined` on success. Repeating the same declaration is harmless. A matching request for admitted state returns it without another walk; a contradictory request returns a validation Error without changing the established mode.

`externalState` applies shallowly to records, Arrays, and class instances. A Function, Promise, callable thenable, or primitive returns a validation Error. `managedState` declares a class instance, or every class instance currently reachable through unadmitted managed state. It preserves aliases and cycles and does not register encountered classes. Nested declared or admitted external identities, uninspectable identities, admitted managed identities, Errors, and Functions stop the walk; passing an external or uninspectable identity as the root returns a validation Error. Arrays remain managed unless explicitly declared external. Validate the complete walk and every managed-class prototype before recording anything.

A class instance added later follows its own identity declaration or exact class rule. `managedStateClass` affects only subsequently admitted instances of the supplied exact prototypes. It validates every supplied class and prototype before changing the registry and returns a validation Error if any is invalid. Declarations never resolve a Promise or callable thenable: `externalState` returns a validation Error for one as its argument, and `managedState` does so for one anywhere in its walk. Sampling during validation permanently captures thenability without admitting a category.

## Classification

Keep identity declarations outside application objects and managed class prototypes in one registry. Resolve callable thenables before admission. Preserve Error and Function semantics first. An identity obtained as live state of an external property remains external, including a record or Array. An explicit external declaration likewise makes a record, Array, or class instance external. Otherwise Arrays retain intrinsic semantics, records default to managed, and a class instance follows its explicit managed declaration, the exact managed-class registry, or the external default. Records and Arrays passed to `managedState` are traversal roots and receive no redundant declaration.

An identity declaration selects a category but does not bind a prototype. Admission stores the category and prototype then present and discards any consumed identity declaration. A managed prototype present at admission must satisfy the managed-class contract. Later declarations, registry changes, and prototype changes never alter those admitted facts. A managed copy receives fresh metadata with the source category and prototype but no declaration entry. External identities are never copied.

## Import

`import` is the sole boundary for host data entering the language graph. It is used only for:

- a host root explicitly passed to the public `import` API, including each context root as a whole;
- every native JavaScript call result;
- every accepted controlled host-callback result that enters the graph; and
- every external-property read result.

A Promise fulfilled from one of these boundaries continues that same import; it is not another boundary case. Assignment, managed lookup, Chain transfer, and other movement within Cascada preserve admission and origin without importing again.

A synchronous scalar callback result consumed only as controlled-operation control data does not enter the graph. Validate it directly under that callback's result contract.

One importer applies the boundary's ownership policy. A synchronous segment validates its complete reached shape before committing origin, sharing, or Promise mirrors. It traverses each new managed identity once while preserving aliases and cycles and stops at Functions, Errors, and external identities. A new host-produced managed identity becomes imported and shared. Existing identity metadata identifies an admitted result: retain it without traversing it again, preserve its origin, and mark it shared when the result adds an owner. This permits another Cascada execution to return unexported managed data without a redundant import walk.

A complete ready or direct-Promise result passes through import once. Direct fulfillment produces the imported value or admission Error, while rejection remains rejection. Promise fulfillment continues the same import boundary for newly reached values. Imported storage retains its physical Promise while its mirror holds the logical value.

A new identity read from an external property remains external. Managed state may contain external identities, but external state may contain no admitted managed identity. Detect this only when property traversal actually reaches one; poison the external container without replacing either identity and never scan external state merely to find violations. A host method may instead return separately declared, default-managed, or already admitted managed data through its independent result import.

## Export

Export is the sole outbound data boundary. It is used for:

- every explicit argument passed to native JavaScript, including managed, external, and native methods;
- declared inputs passed to a host callback by a runtime-controlled method;
- every value assigned to an external property;
- every script result.

Runtime-controlled methods such as supported Array methods consume logical Cascada values directly. A host callback invoked by one is a separate export boundary.

Export resolves required availability, removes runtime representations, and copies managed records, Arrays, and class instances into independent host data while preserving aliases, cycles, Array structure, and admitted prototypes. One boundary operation exports its ordered roots with one identity map, preserving aliases across input positions. Each root consumes every distinct Error beneath it; a batch combines failed roots in order, and no Error reaches host code. A controlled operation that invokes one host callback repeatedly prepares one shared exported snapshot for those invocations. Functions and external identities remain exact. Managed receiver isolation remains a separate ready-state copy operation.

Export uses no managed source lease. Its synchronous walk copies every ready placement. Exact Promise mirrors preserve pending property versions whose FIFO continuations synchronously traverse each newly revealed branch once, without rereading already captured source state. Host code may retain exported copies, Functions, and exact external identities, but receives no external mutation authority through export. Independent host mutation remains outside Cascada's ordering guarantees.

Completed or discarded output releases its export state without closing a containing operation. Fatal failure closes the operation, which releases partial export state. Later registered continuations still complete shared Promise-mirror and property-version settlement, then stop before doing more export work. Error collection remains open until every required branch has been inspected, although it discards output copies after the first Error.

## Managed methods

Records and classes use the single boundary defined in [`managed-invocation.md`](managed-invocation.md). A record selects an own enumerable Function-valued placement; a class selects from its admitted prototype chain. Selection occurs only after complete receiver preparation and explicit-argument export. The boundary then isolates mutation state when required, invokes once, validates and publishes a mutation, and imports the result.

The caller's mode is trusted: observations do not mutate their receiver, and mutations change only their isolated receiver. Exported managed arguments are independent; exact Functions and external identities remain read-only. External identities nested in a managed receiver are opaque leaves and require a separate external Cascada operation for host access.

Receiver and argument work share one operation lifetime. One direct Promise extends it; a nested result Promise does not. Observations retain receiver leases through direct completion, mutations keep private state behind the ordinary transition gate, and managed mutation-result import gives exact receiver/result aliases shared ownership.

## External ordering

[`external-context-ordering.md`](external-context-ordering.md) defines external mutation authority, path-use validation, readers-writer guards, external argument observations, poison, and repair.

Phase 9 context construction marks the Chain and builds its occurrence index through the common importer. One WeakMap shared by the Chains of an execution records each external identity as unused, used through one exact context Chain and path with sticky staticness and mutation-authorized facts, used outside context, or used from multiple locations. Only actual lookup, receiver, property, and argument use updates it. The first valid mutation fixes its compiler-static context location; every later use must follow it, while an incompatible use fails before host access.

Each context Chain keeps a path index of external occurrences, maintained independently of use history. Reader-writer phase state belongs to each selected mutation-eligible identity. Context operations select exact identities or indexed descendants. Outside-context external use is observation-only and unphased: it fails if the identity is already fixed elsewhere and otherwise prevents future mutation. The first selected external identity on a context path guards host traversal below it, while incompatible alias use still fails through the identity's shared use state.

External operations may mutate deeply reached properties. Cascada records identities when reached but never scans external graphs for shared descendants. Host code must not expose the same mutable resource through independently scheduled external roots.

External property access and method calls operate on exact host state. A property read imports its value. A property write exports any supported value before native assignment; any reached Error prevents the write. Functions and external identities remain exact, while managed structures and class instances are independent prototype-preserving copies. Successful assignment returns the captured logical right-hand value, deletion returns the native Boolean, and a native setter must finish synchronously.

Register the complete context receiver and argument guard set when the operation enters the graph API, before its first wait. Never add a guard while retaining earlier ones. After predecessor phases finish, export explicit arguments before proxy reflection, descriptor access, getters, or method selection. A later context identity requires an already selected boundary. A later non-context identity records outside use and is rejected only if already fixed elsewhere. Prepare the selected callable without importing it as graph data, invoke once, and import only the property-read or call result. A direct Promise retains guards through fulfillment import or rejection.

## Scope

Managed records and classes share one invocation instead of using a record-specific path. The architecture reuses one import boundary, one export boundary, and ordinary managed COW, leases, gates, mirrors, and publication. External ordering adds one readers-writer phase mechanism, identity use state, phase state for selected mutation-eligible identities, and one occurrence index per context Chain; it adds no hidden Chain, special importer, external graph model, or second invocation coordinator.
