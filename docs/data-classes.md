# Managed and external state

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document records the implemented classification and copying behavior.

## Status

Implemented. Admission permanently classifies each identity as managed or external. Records and Arrays default to managed; class instances default to external. Managed records and class instances support the methods described in [`managed-invocation.md`](managed-invocation.md), and managed class copies preserve their admitted prototype.

## Declarations

Declarations affect later admission without admitting or modifying their input:

```js
externalState(recordOrArray)
managedState(new Vec2(1, 2))
managedStateClass(Vec2, Line2)
```

- `externalState(value)` declares one exact record, Array, or class instance external. It is shallow and overrides a managed-class declaration for that identity.
- `managedState(value)` declares a class instance managed. Given unadmitted managed state, it also declares every currently reachable class instance while preserving aliases and cycles. Nested declared or admitted external identities, uninspectable identities, admitted managed identities, Errors, and Functions stop the walk; an external or uninspectable root fails.
- `managedStateClass(...classes)` declares each exact prototype managed for instances admitted later. It is not inherited.

`externalState` and `managedState` return the exact value on success and return an Error argument unchanged. `managedStateClass` returns `undefined`. Invalid or conflicting declarations return a validation Error. Each new declaration validates its complete synchronous input before recording anything; none waits for Promises. A matching request for admitted managed or external state returns the value without rescanning it. Admission is permanent, so a conflicting request cannot reclassify an identity.

Managed class prototypes may contain data methods but no accessors before `Object.prototype`. All semantic instance state must use own enumerable string-keyed data properties. Managed classes must not require private fields, Symbols, non-enumerable or accessor state, mutable closure or module state, hidden shared mutable storage, or native internal slots. Constructors never run during copying.

## Admission

The first available use records one fixed category and, for managed classes and records, the prototype then present. An earlier identity declaration selects the category without binding the prototype. Explicit identity declarations take precedence over class declarations. Arrays retain Array semantics; callable thenables retain Promise semantics.

Managed records, Arrays, and classes are traversable. External identities, Functions, and Errors are leaves. External values retain their exact identity but currently cannot be path receivers or `run` receivers.

## Copy-on-write

A record or managed-class copy is created from its admitted prototype and populated through the ordinary property pipeline. The copy preserves aliases, cycles, ownership, Promise mirrors, and refcounts without invoking a constructor or copying descriptors or metadata.

Arrays, including cross-realm Arrays and subclasses, use the Array path and normalize to local ordinary Arrays. Records retain their admitted prototype, including cross-realm and null prototypes.

## Invocation and export

`run` uses one managed boundary for records and class instances. It prepares the complete receiver graph and exports every explicit argument before invoking a method. Observations are trusted read-only calls under receiver leases. Mutations isolate protected receiver state, validate it after invocation, and publish it through the ordinary mutation transition. One direct result Promise extends the invocation.

A mutation returning `this` returns the published receiver. Every other result is imported without copying. Shared-graph import of a non-receiver mutation result preserves exact identities while protecting descendants still reachable from the receiver. Public export creates independent metadata-free managed-class copies with their admitted prototypes and keeps external identities exact.
