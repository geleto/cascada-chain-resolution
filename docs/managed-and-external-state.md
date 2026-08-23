# Managed and External State Architecture

## Model

Cascada manages records and Arrays by default. A class instance is external by default unless its identity or class is declared managed. An explicit identity declaration takes precedence over its class default.

Managed state is traversed, Promise-aware, copy-on-write, and replaceable. External state remains exact host state and is observation-only by default. `initializeContext` makes each synchronously reached external identity with one unique context path mutation-capable at that fixed path.

An identity has one classification. The same identity cannot be managed through one alias and external through another; use a copy when both forms are needed.

## Declarations and initialization

The public boundaries are:

```js
externalState(value)
managedState(value)
managedStateClass(...classes)
initialize(value)
```

Declarations do not wrap, modify, or admit their arguments. `externalState` and `managedState` return the original value on success. Repeating the same declaration is harmless; a contradictory identity declaration or one that contradicts an admitted classification returns a validation Error without changing the established mode.

Declarations apply to records and class instances; intrinsic and primitive categories reject a declaration that would change their semantics. `externalState` is shallow. `managedState` declares its argument and every class instance currently reachable through managed record, Array, and class data. It preserves aliases and cycles, stops at explicitly external identities, and does not register encountered classes. Every managed class prototype must satisfy the managed-class contract. Validate the complete walk before recording anything.

A class instance added later follows its own identity or class declaration. `managedStateClass` declares subsequently admitted instances of the supplied exact class prototypes managed. It validates every prototype before changing the registry and does not reclassify admitted instances.

Declarations never resolve a Promise or callable thenable. `externalState` rejects one as its argument, and `managedState` rejects one anywhere in its declaration walk. Managed data may acquire Promises later through ordinary Cascada operations.

`initialize` replaces the public general-purpose import boundary and admits a host-provided root. Internal `initializeContext` uses that same importer while fixing synchronously reached unique external context paths; it is not another import boundary or walker. Managed `!` operations keep ordinary managed behavior.

## Classification

Keep identity declarations outside application objects and managed class prototypes in one registry. Resolve callable thenables before admission. Admission first preserves Error, logical Array, and Function semantics, then applies an explicit declaration to a record or class instance. Without one, records are managed, while class instances use the managed-class registry or the external default. Store the resulting type and admitted prototype in ordinary identity metadata.

Metadata is authoritative after admission. Later declaration or registry changes never reclassify an identity. A managed copy receives fresh metadata with the source's admitted category and prototype; declaration entries are not copied. External identities are never copied.

## External context ordering

[`external-context-ordering.md`](external-context-ordering.md) defines external mutation and observation ordering. One ordinary supplemental Chain contains one sparse guard tree for each context execution. Context initialization fixes unique external paths; ordering barriers remain lazy. Managed paths never enter it.

The compiler supplies each operation's target path and optional `!` segment index. An external mutation path and its selected `!` scope must be static. An observation registers its complete ready path before host access. Runtime external dispatch creates missing scope nodes lazily and bulk-registers scopes before argument preparation or invocation. Ancestors and descendants order in both directions, while siblings remain independent.

An external identity reached through several context paths remains observation-only. A uniquely reached identity becomes context-exclusive immediately and may be used only through its fixed path or an active function borrow; its operations may select different guard scopes. Any managed mutation whose receiver or target is that path or an ancestor returns an Error without changing or poisoning state. Host code must expose one exact identity for one mutable resource and choose a `!` scope covering all state an operation may affect; Cascada cannot detect hidden sharing.

Managed state needs no external guard. Its observations retain protected logical versions, while later mutations may publish COW versions instead of waiting. Managed reference arguments use ordinary managed `enter`; exact external reference arguments use context guards.

## Import and export boundaries

Managed data leaves through export when passed to external, native, or override host code or returned as a public script result. Export resolves required availability, removes runtime representations, and copies managed traversable data; Functions and external identities remain exact. Managed invocation instead operates on prepared and isolated managed state.

Export leases managed sources only while producing the independent host value. Those leases end before invocation. A returned host Promise may retain exported values and active external guard entries, but it cannot retain the copied values' managed sources.

Import is private and processes only host-originated data. Its boundaries are `initialize`, a managed, native, or external host-call result, and a property value read from external state. Context initialization additionally fixes synchronously reached unique external paths; no mutation-capable path is added later. Promise settlement continues its originating boundary. Chain construction, assignment, lookup, and other internal transfers do not import.

One importer applies the boundary's ownership policy. It honors `externalState` and `managedState` declarations returned by host code and never reclassifies or rescans an admitted identity.

Each synchronous import segment first captures and validates the complete reached shape, then commits origin, sharing, and Promise mirrors. It traverses each new managed identity once while preserving aliases and cycles, and stops at Functions, Errors, and external identities. Promise fulfillment continues the same boundary.

Import is one-way. Host-produced managed identities become imported and are never rescanned for later host changes. A synchronous managed result passes through import before its independent copy; that copy is runtime-owned.

An external property read imports its result before completing the observation. A direct Promise keeps its external guard entry through settlement and fulfillment import.

## Managed methods

Every own enumerable string-keyed function data property of a managed record is available as a method. Selection captures that logical property version, never searches the record prototype, and invokes the function with the prepared record as `this`. Outside a supported call position, the Function remains ordinary data.

A managed class uses methods from its admitted prototype chain under the managed-class contract. Record and class methods otherwise share managed invocation: complete input preparation, receiver and argument protection, mutation isolation, final validation, publication, and result handling.

Nested calls such as `this.increaseBy(1)` are ordinary JavaScript on the already prepared and isolated receiver. They do not start another Cascada invocation. The outer invocation validates and publishes their combined effect.

An observation remains read-only. A method may access its prepared inputs and, for a mutation, change its isolated receiver until its direct result settles. Every asynchronous access or effect must belong to work represented by that Promise and complete before it settles; detached work is forbidden.

External operations remain separate ordered Cascada calls. A managed method must not invoke or mutate external state directly and bypass context ordering.

## Managed method lifetime

A direct Promise keeps a method call active until settlement. A Promise contained in a synchronously returned value is independent result data and does not extend the call. A managed direct Promise returns an operation Promise that applies normal result handling to fulfillment and preserves rejection.

A managed observation leases every traversable receiver and argument identity until its direct Promise settles. Later mutations proceed through COW without waiting.

A managed mutation keeps its isolated receiver private behind the ordinary transition gate and retains its argument leases. Receiver-source preparation leases end when isolation begins because the gate owns the private receiver. On fulfillment, validate and publish the receiver, then process the fulfillment as a managed result; fulfillment with the working receiver returns the published receiver. A receiver validation failure poisons the receiver and becomes the fulfilled operation result. On rejection, poison the receiver as for a mutator throw while preserving the rejection as the operation outcome. Release the argument leases after either settlement path.

A synchronous managed mutation publishes immediately. Returning its receiver returns the published receiver; every other synchronous traversable managed result retains the independent-copy rule. Promise placements inside that result are imported and copied without waiting.

## External operations

External property access and method calls operate on exact host state. An observation-only identity may be observed from any value. Mutation requires an external context path with `!`; managed dispatch uses its ordinary mutation behavior without entering the external guard tree.

An external context path uses the guard tree's hierarchical readers-writer order. `!` marks writes; unmarked external context access is an observation and joins a group that later writes await. Function arguments may borrow an identity from its fixed context path, holding the selected observation or mutation scope through the direct result Promise. A borrow may pass through nested calls but cannot escape the call.

The guard orders one context execution only. Sharing a mutable host resource across executions leaves their concurrency and ordering to the host.

A property read privately imports and initializes its value before completing. A property write exports its value before native assignment and is ordered with method use of every overlapping path. Native setters must complete synchronously. Method arguments use the same export, and method results use the same private import, as every other host boundary.

Ready operations remain synchronous. A direct Promise keeps its guard entry through settlement. Independently retained host references remain outside Cascada's ordering guarantees.

## Scope

Generalize registered-class invocation into managed invocation rather than adding a record-specific path. External ordering belongs to context dispatch and one guard Chain; external invocation consumes it without another coordinator. Managed graph transitions retain their existing value, ownership, Promise, COW, and publication mechanisms.
