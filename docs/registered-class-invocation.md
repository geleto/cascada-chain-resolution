# Registered-Class Invocation Architecture

## Status and purpose

This is the accepted architecture for registered-class execution, planned in Phases 5 and 8 of [`first-principles-conformance-plan.md`](first-principles-conformance-plan.md).

A registered instance remains ordinary Cascada graph data. Registration supplies its executable class surface and the prototype ordinary COW preserves; it creates no permanent ownership unit. Complete receiver isolation begins only when JavaScript invokes a registered method or accessor. A registered argument follows the ordinary host-snapshot boundary.

## State contract

All semantic state must be reachable through own enumerable string-keyed data properties. Host-ready state may contain primitives, records, logical Arrays, and nested registered instances. Functions, opaque identities, and Errors are invalid values; own accessors, Symbols, and non-enumerables are invalid surface. Private fields, internal slots, and closure state must not carry semantic state.

A Promise may temporarily occupy runtime-owned or imported state, but registered JavaScript receives only its resolved logical value. Rejection contributes an Error to call preparation and prevents invocation. Imported physical storage retains its Promise unchanged, and import does not validate registered state.

Nested registered instances remain ordinary nested graph values. For example, `Line3 { start: Vec3, end: Vec3 }` is not a permanent unit; snapshots preserve its aliases and cycles.

## Ordinary graph behavior

Assignment, deletion, lookup, import, `enter`, indexing, Promise mirrors, and refcounting treat registered instances like other traversable containers. Ownership remains per identity and path mutation uses ordinary COW.

A shallow COW copy preserves the prototype captured at admission. Thus changing `line.start.x` copies only the protected path, not the whole receiver graph, while preserving both the `Line3` and `Vec3` prototypes.

## Receiver snapshot

Every registered method or accessor receives one complete prototype-preserving receiver snapshot. Observations use the same complete snapshot as mutations because arbitrary class code may inspect any reachable receiver state.

Receiver and host-bound arguments share one operation-local copy graph. It reads logical property versions, resolves the complete Promise frontier through mirrors and FIFO continuations, materializes logical Arrays and other internal representations as native host data, preserves registered prototypes, aliases, cycles, Array holes, and property order, and retains terminal values until inspection.

The engine has two container forms: host-call snapshots preserve admitted registered prototypes, while public export normalizes them to plain data. It also has two inspection policies: ordinary host inputs permit exact opaque and Function leaves, while registered state does not. All receiver and argument roots share the copy graph.

Once every root is ready, inspect them in receiver-then-argument order. An identity visited under one policy must still be inspected under the other, including when its permissive path is encountered first. One shared Error set removes duplicates and makes ordering independent of Promise settlement. Existing Error identities are preserved and aggregated normally; unsupported registered state produces a validation Error. Either skips invocation, so JavaScript receives no Error, unresolved Promise, unsupported state, internal representation, or original traversable graph identity.

Snapshot preparation inspects each registered identity's raw own surface before normalization. Failure while reflecting on source data is preparation poison; an observed forbidden surface is a fatal registration-contract violation. Final validation applies the same admissibility rules to every private container, but invalid state left by registered code is fatal and unpublished. Declared Array and internal-representation structure is exempt. Private fields, internal slots, and closure state remain trusted restrictions because the runtime cannot inspect them exhaustively.

Capture the requested receiver path and explicit argument values when the call is issued. Traverse and register receiver-path dependencies before argument preparation, capturing the receiver placement and each nested property version when reached. Each transition copies its complete available frontier before returning. It captures every unresolved branch through its property mirror and copies that branch synchronously when its FIFO continuation resumes. Later source mutation can therefore affect neither copied data nor pending captured versions, so preparation needs no source lease.

Once the receiver is available, select its class descriptor before that transition yields. Invoke registered code through the supported-user-code boundary; synchronous Cascada reentry is fatal.

## Observations

A registered observation invokes its selected method or getter once on the snapshot and never on published Cascada storage. Its declared behavior is side-effect-free; any incidental physical mutation remains confined to the discarded snapshot.

Preparation poison or a synchronous throw becomes the observation result. Results follow normal origin admission: snapshot identities are imported, while exact unsnapshotted arguments retain their origin.

## Mutations

A registered mutation invokes its method or setter once and synchronously on the private snapshot. The complete snapshot is its isolation boundary because JavaScript may mutate any nested state. If preparation waits, install the ordinary transition gate at the captured receiver placement; no state property needs a separate gate.

After a successful call, one final walk validates and admits the receiver graph and records its identities in a `WeakSet`. Publish the root once through ordinary replacement, which owns indexing and reverse-edge maintenance. Invalid final state is fatal and unpublished; preparation poison or a synchronous throw instead replaces the receiver placement with the Error and returns it.

Publication preserves aliases and cycles inside the snapshot but may sever an alias between receiver state and another graph placement. The external placement retains its prior identity while the receiver publishes its copy. This identity split is observable, but both owners remain logically isolated.

A method must finish state mutation before returning. A returned Promise is only the independent API result and retains its original fulfillment or rejection. Publish the receiver immediately, then lease it until settlement because host code may retain it; later host mutation is a contract violation.

Use the final-validation `WeakSet` during result admission. Identities in the published receiver remain runtime-owned, are marked shared when the result adds an owner, and stop admission from traversing or reimporting their graph. Exact unsnapshotted opaque and Function arguments also retain their origin. Import every other result identity, including a piece removed from the snapshot. Retain these call-scoped origin facts until a returned Promise settles.

A class-defined setter receives one resolved exported value and ignores its return, including a thenable. It must still finish state mutation synchronously. Getters use the observation transition. Select class descriptors from the admitted prototype and its inherited chain up to, but excluding, `Object.prototype`; an own language placement shadows the class surface.

## Integration boundary

Registered-specific behavior belongs in descriptor selection and the host-call coordinator. The snapshot walk may also serve public export, Array overrides, and other host arguments, but ordinary graph operations do not participate in registered receiver preparation.

## Verification

The Phase 5 and Phase 8 verification sections in [`first-principles-conformance-plan.md`](first-principles-conformance-plan.md) are the integration checklist for this architecture.
