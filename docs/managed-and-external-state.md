# Managed and External State Architecture

## Model

Cascada manages records and Arrays by default. A class instance is external by default unless its identity or class is declared managed. An explicit identity declaration takes precedence over its class default.

Managed state is traversed, Promise-aware, copy-on-write, and replaceable. External state is one exact atomic identity: Cascada neither traverses nor copies it, and all aliases share its ordered host effects.

An identity has one classification. The same mutable identity cannot be managed through one alias and external through another; use a copy when both forms are needed.

## Declarations

The public declarations are:

```js
externalState(value)
managedState(value)
managedStateClass(...classes)
```

They do not wrap or modify their arguments. `externalState` and `managedState` return the original value on success. Repeating the same declaration is harmless; a contradictory identity declaration or one that contradicts an admitted classification returns a validation Error and leaves the earlier classification unchanged.

`externalState` declares only its argument identity. `managedState` declares its argument and every class instance currently reachable through managed record, Array, and class data. It preserves aliases and cycles, stops at explicitly external identities, and does not register the classes it encounters. It validates the complete walk before recording anything, so failure leaves no partial declarations.

A class instance added after that walk follows its own identity or class declaration; containment does not declare the new identity or its class.

`managedStateClass` declares all subsequently admitted instances of the supplied exact class prototypes managed. It validates every prototype before changing the registry and does not reclassify existing instances. An identity declaration overrides this class-wide rule.

These APIs never resolve a Promise or callable thenable. `externalState` rejects one as its argument, and `managedState` rejects one anywhere in its declaration walk. Managed data may acquire Promises later through ordinary Cascada operations.

## Classification

Keep identity declarations in one external `WeakMap` and managed class prototypes in one `Set`; do not add properties to application objects. Admission applies intrinsic precedence first, then classifies records as managed and class instances from the identity declaration, class registry, or external default. It stores the resulting type and admitted prototype in ordinary identity metadata.

Metadata is authoritative after admission. Later declaration or registry changes never reclassify an identity. A Cascada copy receives fresh metadata with the source's admitted category and prototype; declaration entries are not copied.

Importing an external identity records its import origin but stops before its properties. Mutable identities must not be shared across managed and external state boundaries where external code can change them.

## Import boundaries

Host data enters through the imported context and through managed, native, or external host-call results. Chain construction, assignment, and internal value transfer do not imply import.

Import walks every reached managed identity once, records its boundary, and immediately registers every reached Promise placement through the existing version and FIFO continuation machinery. Promise fulfillment continues import under the captured boundary. The walk stops at Functions, Errors, and external identities.

Common result import marks each new host-produced identity imported while preserving the origin of an identity already supplied by Cascada. A blanket reimport must not turn a managed receiver or argument into imported data. A synchronous managed result passes through this import before its independent copy; the copy is runtime-owned, while retained exact external identities keep their imported origin.

## Managed methods

Every own enumerable string-keyed function data property of a managed record is available as a method. Selection captures that logical property version, never searches the record prototype, and invokes the function with the prepared record as `this`. Outside a supported call position, the Function remains ordinary data.

A managed class uses methods from its admitted prototype chain under the existing managed-class contract. Record and class methods otherwise share the registered-class invocation mechanism: complete input preparation, receiver and argument protection, mutation isolation, final validation, publication, and result handling.

Nested calls such as `this.increaseBy(1)` are ordinary JavaScript on the already prepared and isolated receiver. They do not start another Cascada invocation. The outer invocation validates and publishes their combined effect.

An observation remains read-only. A method may access its prepared inputs and, for a mutation, change its isolated receiver until its direct result settles. Every asynchronous access or effect must belong to work represented by that Promise and complete before it settles; detached work is forbidden.

External operations remain separate ordered Cascada calls. A managed method must not invoke or mutate external state directly and bypass its identity ordering.

## Method lifetime

A direct Promise keeps a method call active until settlement. A Promise contained in a synchronously returned value is independent result data and does not extend the call. A managed direct Promise returns an operation Promise that applies normal result handling to fulfillment and preserves rejection.

A managed observation leases every traversable receiver and argument identity until its direct Promise settles. Later mutations proceed through COW without waiting.

A managed mutation keeps its isolated receiver private behind the ordinary transition gate and retains its argument leases. Receiver-source preparation leases end when isolation begins because the gate owns the private receiver. On fulfillment, validate and publish the receiver, then process the fulfillment as a managed result; fulfillment with the working receiver returns the published receiver. A receiver validation failure poisons the receiver and becomes the fulfilled operation result. On rejection, poison the receiver as for a mutator throw while preserving the rejection as the operation outcome. Release the argument leases after either settlement path.

An external observation keeps its per-identity observation entry until its direct Promise settles. Other observations may overlap, but a later external mutation waits. A direct Promise from an external mutation keeps its barrier until settlement, so every later use waits.

A synchronous managed mutation publishes immediately. Returning its receiver returns the published receiver; every other synchronous traversable managed result retains the independent-copy rule. Promise placements inside that result are imported and copied as Promise placements without waiting.

## Scope

Generalize registered-class invocation into managed invocation rather than adding a record-specific path. Declarations affect classification only. Ordinary lookup, assignment, deletion, refcounting, Promise mirrors, COW, import, and mutation publication continue to use their existing mechanisms.
