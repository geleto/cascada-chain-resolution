# Managed and External State Architecture

## Model

Cascada manages records and Arrays by default. A class instance is external by default unless its identity or exact class is declared managed. An explicit identity declaration takes precedence over its class default, and admission fixes one classification for the identity.

Managed state is traversed, Promise-aware, copy-on-write, and replaceable. External state remains exact host state and is observation-only by default. Phase 9 allows mutation only after actual use through one compiler-static path of one context Chain.

## Declarations

```js
externalState(value)
managedState(value)
managedStateClass(...classes)
import(value, errorContext)
```

Declarations return their original argument without wrapping, modifying, or admitting it. Repeating the same declaration is harmless. A contradictory declaration or one contradicting an admitted classification returns a validation Error without changing the established mode.

`externalState` applies shallowly to records, Arrays, and class instances. Functions, Errors, Promises, callable thenables, and primitives reject it. `managedState` declares its argument and every class instance currently reachable through managed record, Array, and class data. It preserves aliases and cycles, stops at explicitly external identities, and does not register encountered classes. Arrays remain managed unless explicitly declared external. Validate the complete walk and every managed-class prototype before recording anything.

A class instance added later follows its own identity or class declaration. `managedStateClass` affects only subsequently admitted instances of the supplied exact prototypes and validates every prototype before changing the registry. Declarations never resolve a Promise or callable thenable: `externalState` rejects one as its argument, and `managedState` rejects one anywhere in its walk.

## Classification

Keep identity declarations outside application objects and managed class prototypes in one registry. Resolve callable thenables before admission. Preserve Error and Function semantics first. An identity obtained as live state of an external property remains external, including a record or Array. An explicit external declaration likewise makes a record, Array, or class instance external. Otherwise Arrays retain intrinsic semantics, an explicit managed declaration controls a record or class instance, records default to managed, and class instances use the exact managed-class registry or external default.

Store the admitted category and prototype in identity metadata. Later declarations and registry changes never reclassify it. A managed copy receives fresh metadata with the source category and prototype but no declaration entry. External identities are never copied.

## Import

`import` is the sole inbound data boundary. It handles every host-provided root, including context roots, and is reused internally for native JavaScript call results, external-property reads, and values later fulfilled by Promises from those boundaries. Assignment, lookup, Chain transfer, and other movement within Cascada preserve admission and origin without importing again.

One importer applies the boundary's ownership policy. A synchronous segment validates its complete reached shape before committing origin, sharing, or Promise mirrors. It traverses each new managed identity once while preserving aliases and cycles and stops at Functions, Errors, and external identities. A new host-produced managed identity becomes imported and shared. Existing identity metadata identifies an admitted result: retain it without traversing it again, preserve its origin, and mark it shared when the result adds an owner. This permits another Cascada execution to return unexported managed data without a redundant import walk.

A complete ready or direct-Promise result passes through import once. Direct fulfillment produces the imported value or admission Error, while rejection remains rejection. Promise fulfillment continues the same import boundary for newly reached values. Imported storage retains its physical Promise while its mirror holds the logical value.

A new identity read from an external property remains external. Managed state may contain external identities, but external state may contain no admitted managed identity. Detect this only when property traversal actually reaches one; poison the external container without replacing either identity and never scan external state merely to find violations. A host method may instead return separately declared, default-managed, or already admitted managed data through its independent result import.

## Export

Export is the sole outbound data boundary. It is used for:

- every explicit argument passed to native JavaScript, including managed, external, native, and override methods;
- every value assigned to an external property;
- a native Array override receiver;
- every public script result.

Runtime-controlled methods such as supported Array methods are the exception and consume logical Cascada values directly.

Export resolves required availability, removes runtime representations, and copies managed records, Arrays, and class instances into independent host data while preserving aliases, cycles, Array structure, and admitted prototypes. Functions and external identities remain exact. Host-input export preserves nested Errors but a consumed top-level Error prevents invocation or assignment. Public-result export consumes every reached Error. Use one copier with these two Error policies.

Managed source leases last only while export reads them and end before host code runs. Host code may retain exported copies, Functions, and exact external identities, but receives no external mutation authority through export. Independent host mutation remains outside Cascada's ordering guarantees.

## Managed methods

Every own enumerable string-keyed data placement of a managed record is a possible method. Prepare its captured logical version before testing callability, then invoke a Function with the prepared record as `this`. Inherited properties, accessors, non-enumerables, and resolved non-Functions are unavailable. A managed class selects methods from its admitted prototype chain under the managed-class contract.

Records and classes share one managed invocation. Prepare the complete receiver graph, export every explicit argument, isolate a mutation receiver, invoke once, validate and publish mutation, and import the result. Nested calls such as `this.increaseBy(1)` are ordinary JavaScript on the already prepared receiver.

The caller's mode is a trusted assertion about the selected method. An observation does not mutate its receiver; a mutating method runs only in mutation mode. Exported managed arguments are independent and may be mutated, retained, or returned without changing Cascada source data. Functions and external identities remain exact and keep their boundary and guard contracts. Every method keeps mutable semantic state in `this` and receives other mutable state explicitly; it does not depend on mutable parent, closure, module, private, hidden, or internal state.

A direct Promise keeps the invocation active until settlement. All later receiver and argument access must belong to that Promise and finish before it settles; detached work and Cascada reentry are forbidden. A nested result Promise is independent data and receives no later receiver access.

A pending observation retains receiver leases through settlement; later mutation proceeds through COW without waiting. A mutation keeps its isolated receiver private behind the ordinary transition gate. Argument-source leases end when export finishes. Fulfillment imports the result; rejection preserves rejection and applies the ordinary observation or mutation graph effect. A completed mutation receiver contains neither Promise nor Error.

Importing a managed result preserves admitted identities and adds ordinary shared ownership instead of copying the result. Returning the mutation receiver returns its published identity.

## External ordering

[`external-context-ordering.md`](external-context-ordering.md) defines external mutation authority, path-use validation, readers-writer guards, argument borrows, poison, and repair.

Phase 9 context construction marks the Chain and builds its occurrence index through the common importer. One WeakMap shared by the Chains of an execution records each external identity as unused, used through one exact context Chain and path with sticky staticness and mutation-authorized facts, used outside context, or used from multiple locations. Only actual lookup, receiver, property, and argument use updates it. The first valid mutation fixes its compiler-static context location; every later use must follow it, while an incompatible use fails before host access.

Each context Chain keeps a path index of external occurrences, maintained independently of use history. External reader-writer phase state belongs to the identity, so every alias shares ordering. Exact operations select the identity directly; context-prefix operations select indexed descendants.

External operations may mutate deeply reached properties. Cascada records identities when reached but never scans external graphs for shared descendants. Host code must not expose the same mutable resource through independently scheduled external roots.

External property access and method calls operate on exact host state. A property read imports its value. A property write exports any supported value before native assignment; a top-level Error prevents the write. Functions and external identities remain exact, while managed structures and class instances are independent prototype-preserving copies. Successful assignment returns the captured logical right-hand value, deletion returns the native Boolean, and a native setter must finish synchronously.

Register every receiver and argument guard when the operation enters the graph API. After predecessor phases finish, export explicit arguments before proxy reflection, descriptor access, getters, or method selection. Prepare the selected callable without importing it as graph data, invoke once, and import only the property-read or call result. A direct Promise retains guards through fulfillment import or rejection.

## Scope

Generalize registered-class invocation into managed invocation instead of adding a record-specific path. Reuse one import boundary, one export boundary, and ordinary managed COW, leases, gates, mirrors, and publication. External ordering adds one readers-writer phase mechanism, use and phase state per external identity, and one occurrence index per context Chain; it adds no hidden Chain, special importer, external graph model, or second invocation coordinator.
