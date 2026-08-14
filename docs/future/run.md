# Deferred Standalone Functions and Proxy-Backed Mutating Class Methods

## Status

**Deferred and archived for possible future work.** This is not part of the
current implementation plan.

The runtime graph remains data-only and Functions are not language data.
[`run`](../run.md) supports trusted synchronous methods on registered classes;
proxy-backed methods for unregistered or less restricted classes remain
deferred.

This document records the design to use if broader invocation is revisited. It combines:

- [`enter`](../enter.md) for exact receiver capture, ordering, isolation, and
  publication; and
- an operation-local recursive draft proxy for ordinary JavaScript class
  methods that read and write through `this`.

The earlier proxy proposal predated the completed callback-based `enter`
primitive and had to design its own readiness placeholder, captured placement,
and commit ordering. Its still-useful analysis is retained in
[`run-draft-proxy-archive.md`](run-draft-proxy-archive.md). This document
supersedes that proposal only as a future design; neither document changes the
data-only runtime contract.

## Scope

If implemented, this proxy-backed extension would have exactly two invocation
forms:

1. side-effect-free standalone functions selected outside the graph; and
2. methods on registered data-class instances that may mutate their
   own state.

It would not:

- store functions or method descriptors in the language graph;
- replace the standard built-in operations defined by [`run`](../run.md);
- invoke constructors;
- provide general JavaScript reflection or arbitrary callable dispatch;
- make unsupported host objects into language data; or
- turn external side effects into a transaction.

A standalone callable would come from compiler or host integration metadata. A
class method would come from the registered-class receiver's prototype together with a
trusted method descriptor. Own enumerable graph properties remain data even
when their keys shadow method names.

The first mutating subset would execute normal synchronous JavaScript such as:

```js
class Point {
    move(dx, dy) {
        this.x += dx
        this.y += dy
    }
}
```

The method receives a draft proxy as `this`. Its writes do not touch tracked
runtime state directly.

## Conceptual entry points

The exact source syntax is intentionally left open. The internal shapes would
remain distinct:

```js
runFunction(functionDescriptor, ...capturedArguments)

runMethod(
    chain,
    receiverPath,
    methodDescriptor,
    mutates,
    ...capturedArguments
)
```

`mutates` must be exactly `true` or `false`.

A method descriptor would record:

- the exact supported prototype or class;
- a getter-free method lookup;
- whether the method is trusted read-only or proxy-backed mutating;
- whether the method body must finish synchronously;
- whether the ready direct path is permitted; and
- any result and argument restrictions.

Descriptors and standalone callables live outside the graph. The runtime must
not interpret an own language-data property as executable merely because its
value happens to be callable.

## Supported receivers

A method receiver must satisfy the existing
[`data-class`](../data-classes.md) registration contract.
Its meaningful state consists entirely of own enumerable string-keyed data
properties, and its exact prototype can be used to create a copy shell without
running a constructor.

Registration already preserves:

- prototype identity and `instanceof`;
- inherited and overridden methods;
- ordinary language-property copy-on-write;
- aliases and cycles;
- Promise mirrors, Errors, refcounts, and ownership metadata; and
- isolation from imported host state.

Registration does not make an opaque method safe. The proxy invocation layer
adds that separate execution protocol.

## Why combine proxies with `enter`

The proxy and `enter` solve different halves of method execution.

The recursive draft proxy supplies ordinary JavaScript behavior inside one
method call:

- `this.x = 3`;
- creation and deletion of supported properties;
- nested mutation;
- reads after writes;
- aliases observing the same draft identity; and
- a final logical graph that can be validated before publication.

`enter` supplies the graph-level transition:

- capture of the exact receiver property version;
- gate installation before waiting for arguments;
- owning-path copy-on-write and imported-boundary handling;
- isolation through a private Chain;
- ordering of later receiver traversals behind the gate;
- immediate supersession by a later direct receiver replacement;
- callback lifetime and abnormal closure; and
- automatic publication after successful completion.

This removes the old proxy proposal's separate readiness placeholder,
captured-location transform, ancestor commit protocol, and publication
continuation. It does not remove recursive draft construction or graph
reconciliation.

## Invocation modes

### Ready synchronous path

Available work must remain synchronous. `runMethod` therefore avoids `enter`
when all of the following are true:

- the receiver path is synchronously available;
- every argument is synchronously available;
- the receiver graph passes the draftability check;
- the descriptor guarantees a synchronous method body; and
- draft invocation, validation, reconciliation, and result preparation can all
  complete synchronously.

The transition is:

```text
capture ready receiver and arguments
create the operation-local recursive draft
invoke the method with the draft receiver as this
validate and finalize the draft
replace the receiver at the current program position
return the translated result
```

No other graph operation can interleave with that synchronous transition, so a
gate is unnecessary. Reconciliation must still use sanctioned runtime
transitions; it must not mutate the public receiver directly.

The descriptor must declare synchronous behavior before invocation.
`runMethod` cannot invoke publicly and switch to an entered path after seeing a
Promise result.

### Entered path

If the receiver or any argument is pending, `runMethod` enters the receiver
before waiting:

```js
return enter(chain, receiverPath, true, entered => {
    return invokeDraftMethod(entered, methodDescriptor, capturedArguments)
})
```

The conceptual transition is:

```text
capture argument positions
install the receiver gate through mutating enter
resolve the private receiver and captured arguments
validate the complete receiver graph
create the operation-local recursive draft
invoke the synchronous native method
validate and reconcile into the private Chain
translate the method result
complete the callback and publish through the gate
```

A Promise-valued receiver does not delay `enter` setup. `enter` transfers that
captured version into the private Chain at its FIFO position. The draft helper
waits through the private root before invoking the native method.

Later deeper operations on the public receiver wait behind the gate. Unrelated
paths remain available. A later assignment or deletion at exactly
`receiverPath` creates a newer version immediately and supersedes the gate;
the detached private call still completes for operations that captured it but
cannot overwrite the new live receiver.

### Read-only methods

A trusted read-only method uses read-only `enter`:

```js
return enter(chain, receiverPath, false, entered => {
    return invokeReadOnlyMethod(entered, methodDescriptor, capturedArguments)
})
```

The method receives the protected captured instance as `this`. The read entry
keeps later mutations on copy-on-write paths until the method's declared work
completes.

Read-only behavior remains a trusted assertion. A rejecting recursive proxy
could detect receiver writes, but it could not detect mutation through globals,
closures, unproxied arguments, or host objects, and it would retain most of the
proxy machinery without the mutating benefit.

## Argument ordering

Argument expressions are captured before invocation in normal evaluation
order.

For an entered mutation, the receiver gate is installed before waiting for
those captured arguments:

```text
capture arguments
enter receiver
wait for arguments
invoke draft method
publish receiver
```

Waiting first would allow a later receiver mutation to overtake the call.

An argument that reads from the receiver is captured before gate installation.
Once entered, receiver-dependent preparation uses the private Chain and must
not traverse the public gate from inside its own callback.

Mutating ordinary object arguments is outside the first design. Arguments are
observational inputs and receive the ownership protection appropriate to their
invocation contract.

## Receiver readiness

An opaque JavaScript method cannot participate in implicit Promise reads:

```js
move() {
    this.x += this.velocity
}
```

If `velocity` is physically a Promise, JavaScript performs arithmetic on the
Promise. A proxy getter cannot suspend the expression and resume it at the
runtime's FIFO position.

The initial proxy-backed subset therefore invokes a mutating method only when a
cycle-safe validation walk proves that the complete reachable receiver graph:

- contains no Promise-valued language property;
- contains only supported language-data identities;
- has no accessors or unsupported descriptors required by behavior; and
- can be represented by the recursive draft.

A pending receiver root may settle before this check. Pending descendants do
not cause a whole-receiver wait in the initial design; they produce an
attributed Error result and the method is not invoked.

The same conservative restriction applies to receiver state observed by an
opaque read-only method.

The mutating subset also initially forbids assigning a Promise into the draft.
Supporting that would require precise rules for a later ordinary JavaScript read
of the assigned property during the same call and fresh mirror creation during
finalization.

## Recursive draft model

One canonical draft state and Proxy represent each source identity. A
`WeakMap` maps source identities to their operation-local draft states. New
identities assigned during the call receive draft states as necessary.

A draft state conceptually contains:

```text
source identity
canonical proxy
proxy target
direct property overrides
deleted keys
ordered semantic write log
method-scope permissions
finalized identity, once allocated
```

Reads do not copy data:

1. A supported tracked child becomes its canonical recursive proxy.
2. A direct override wins over the source property.
3. A deleted property reads as missing.
4. Every alias to one identity returns the same proxy.
5. Reads after writes observe the current draft view.

Writes and deletions are recorded rather than applied to tracked state. Every
semantic assignment remains a write even if the new value is `===` to the old
value. Delete-and-reinsert order is retained. This is necessary because
assigning even the same eventual Promise value would be a fresh property
version if Promise writes are supported later.

Proxy targets must preserve JavaScript Proxy invariants. A registered data class
receiver uses an operation-local shell with its exact prototype. Nested
supported data uses the corresponding ordinary shell. No runtime metadata is
placed on proxy targets.

The receiver proxy is the method's `this`. Prototype lookup may therefore
reach the registered-class method normally, but descriptor lookup for dispatch occurs
before draft invocation and must not execute a getter.

## Mutation scope

The first proxy-backed design permits mutation of the entire receiver graph.
It does not implement the former array-of-property-names scope.

Permission follows identities reachable from the receiver in either the
original or final draft graph. This permits:

```js
this.a === this.b
this.a.x = 3
```

Both aliases observe the draft write during the method, and finalization
preserves the alias relationship in the resulting receiver world.

The receiver remains the ownership boundary. Mutation through closure-captured
references, globals, host state, or unproxied arguments is outside the
transaction even when such a reference happens to identify receiver data.

## Finalization and reconciliation

Proxy traps alone are not Chain operations. After successful synchronous
invocation, the finalizer translates the draft's JavaScript identity semantics
into one sanctioned runtime transition.

### Final graph collection

The finalizer walks the logical draft graph, not the proxy targets. It records:

- every final language-data edge;
- reverse edges between identities;
- direct semantic writes and deletions;
- newly introduced identities;
- aliases and cycles;
- returned draft identities; and
- unsupported or escaped values.

The traversal is cycle-safe and uses own enumerable string keys only.

### Materialization set

Directly changed identities seed a copy set. The finalizer propagates that set
backward through final receiver edges until every path from the receiver to a
changed identity has a materialized parent.

This is graph reconstruction rather than ordinary path copy-on-write. It is
required to preserve native JavaScript identity. If `a` and `b` point to the
same changed child, both final edges must point to the same new child. Replaying
only `assignPath(receiver, ["a", "x"], 3)` could instead copy one path and leave
`b` in the old world.

Unchanged identities outside the materialization set are reused. Because old
and new worlds may then both point at them, ordinary ownership preparation
marks them shared where required.

### Allocate before populate

The finalizer allocates a sanctioned shell for every identity in the
materialization set before writing any edge. It then populates the shells from
the final draft view.

Allocating first preserves aliases and cycles. Shell selection reuses the
data-class copy rules:

- supported class identities retain their exact registered-class prototype;
- ordinary language-data containers use their existing supported shell; and
- unsupported identities produce an Error before publication.

Only own enumerable string-keyed data is populated. Constructors, accessors,
and arbitrary setters never run.

### Runtime bookkeeping

Population must use or extract sanctioned kernel helpers so the new graph
rebuilds:

- ownership and shared marks;
- imported boundaries;
- Promise mirrors if Promise writes are added later;
- reverse-parent edges and refcounts;
- Error and Promise subtree counters; and
- cycle-cut placement state.

No source metadata is copied. The completed root is installed through the
public receiver transition on the ready path or through the entered Chain's
private root on the delayed path.

The finalizer must complete synchronously once invocation finishes. It cannot
publish a partially reconstructed graph.

## Method results

A synchronous method may return:

- a primitive;
- an Error;
- ordinary supported data;
- the receiver proxy; or
- a nested draft proxy.

Known proxy identities are translated to their finalized identities before the
proxies are revoked. A result retained by the finalized receiver is shared
before delivery. Other tracked results follow the ordinary ownership contract.

A direct result is returned directly when the entire ready transition is
synchronous. An entered result reports callback completion, not receiver
publication. Later graph operations observe publication through the receiver
gate.

Promise-returning mutating methods are outside the first design. A later
extension would have to choose between:

- finalizing at method return and revoking the proxy, which forbids receiver
  access after an `await`; or
- keeping the draft and receiver gate active until fulfillment, which admits
  native asynchronous mutation and requires strict proxy-lifetime, rejection,
  cancellation, and detached-work rules.

Neither choice makes Promise-valued receiver properties implicitly readable.

## Standalone functions

Standalone functions need no receiver draft or effect path:

```js
runFunction(functionDescriptor, ...capturedArguments)
```

They are trusted to:

- have no observable side effects;
- avoid mutating arguments, globals, closures, I/O, or host state;
- retain no tracked runtime value after declared completion; and
- return only values permitted by the result contract.

Pending arguments are resolved at their captured positions before invocation.
A function may return a direct value or Promise. Rejection becomes an Error
value at the invocation boundary; unexpected runtime failures remain fatal.

The callable lives in compiler or host metadata, never in the data graph.

## Errors and fatal failures

Returning an Error and throwing are distinct:

```js
return new Error("result") // commit draft changes and return Error data
throw new Error("failure") // discard draft changes
```

An expected method throw, draft validation failure, or unsupported receiver
shape discards the draft and returns an Error value. On the entered path, the
private receiver remains unchanged and `enter` publishes that unchanged
captured version before forwarding the Error result.

Unexpected proxy invariant failures, corrupt metadata, impossible
reconstruction state, and kernel contract violations are fatal. Mutating
`enter` closes the private Chain and leaves its gate unresolved rather than
publishing potentially corrupted state.

Only proxy-intercepted receiver changes are discardable. External side effects
are contract violations and cannot be rolled back.

## Unsupported behavior

The initial future design does not support methods whose meaningful behavior
depends on:

- JavaScript private fields;
- Symbol-keyed or non-enumerable state;
- instance or prototype accessors used as state;
- descriptor or prototype mutation;
- `Object.preventExtensions`, `seal`, or `freeze`;
- closure-captured identity-specific state;
- hidden shared mutable storage;
- native internal slots;
- mutation of ordinary object arguments;
- mutation through globals, DOM objects, I/O, or other host state;
- storing a draft proxy outside the synchronous call;
- re-entrant or nested mutating `run`;
- Promise-valued reachable receiver state;
- Promise assignment into the draft; or
- asynchronous access to the draft receiver.

A proxy used as `this` does not carry the target's private-field brand. Binding
the method to the original receiver to recover that brand would bypass every
draft trap.

Ordinary property effects performed by nested supported data may be captured
when they flow through recursive proxies. This does not create a separate
standard-operation API for those data types.

## Interaction with `enter`

The proxy layer must use `enter` only as its public/private receiver boundary.
It does not call `enter` internals or manipulate the gate Promise directly.

On the entered path:

1. `enter` installs the gate and supplies a private Chain.
2. The invocation helper resolves and validates the private receiver.
3. The native method runs against operation-local proxies.
4. The finalizer replaces the private Chain root through a sanctioned
   transition.
5. The helper prepares and returns the method result.
6. Callback completion closes the Chain and starts publication.

The proxy target, draft states, write log, finalization maps, and translated
result exist only for that callback. No proxy or reconciliation object becomes
language data.

The synchronous ready path reuses the same draft and finalizer but skips
`enter`. This is necessary to preserve the kernel rule that all currently
available work completes synchronously.

## Implementation boundary if revisited

The likely modules would be:

```text
src/run.js
src/run-native-draft.js
src/run-finalize-draft.js
test/run.test.js
test/run-native-draft.test.js
```

`run.js` would own descriptor validation, argument capture, ready/entered
selection, result preparation, and Error conversion.

`run-native-draft.js` would own proxy state, traps, scope enforcement, and
revocation.

`run-finalize-draft.js` would own final graph collection, materialization-set
calculation, shell allocation, population, bookkeeping reconstruction, and
proxy-result translation.

The existing shell factory and sanctioned population helpers may need neutral
internal extraction from `mutations.js`. Existing kernel modules must not
depend on `run`, proxies, or method descriptors.

No callable API should be added to `src/index.js` until the complete supported
subset passes both metadata modes and the graph remains data-only at every
boundary.

## Possible implementation phases

These phases are archival guidance, not scheduled work:

1. Pure standalone functions and trusted read-only instance methods.
2. Ready synchronous proxy invocation for direct receiver properties.
3. Recursive canonical drafts for nested supported data.
4. Final graph collection, aliases, cycles, and minimal materialization.
5. Runtime-aware shell population and ownership reconstruction.
6. Delayed receiver and argument integration through mutating `enter`.
7. Result translation, Error behavior, import isolation, and verifier tests.
8. Only after demonstrated need, consider Promise writes, selected mutation
   scopes, Promise-returning methods, or checked read-only proxies.

Every intermediate implementation must reject unsupported shapes before native
invocation or publication. It must not silently fall back to raw receiver
mutation.

## Test matrix if revisited

Every applicable test runs under inline-Symbol and WeakMap metadata modes.

### Data-only dispatch

- callable and descriptors never entering the graph;
- registered and unsupported receiver prototypes;
- inherited, overridden, missing, and shadowed methods;
- getter-free lookup;
- exact `mutates` validation; and
- no package-level API before the feature is complete.

### Draft execution

- direct assignment, creation, and deletion;
- nested mutation and reads after writes;
- exact same-value writes;
- aliases observing one canonical draft identity;
- self-cycles and cross-branch cycles;
- method return of receiver and nested identities;
- method throw discarding the draft;
- returned Error committing the draft; and
- proxy revocation and escape rejection.

### Reconciliation

- minimal materialization of changed identities and ancestors;
- unchanged child reuse with correct sharing;
- exact class prototypes on copied identities;
- own enumerable string keys only;
- aliases and cycles targeting allocated shells;
- imported receiver isolation;
- exact refcounts, parent edges, counters, and cycle cuts;
- tracked result ownership; and
- verifier success after every publication.

### Ordering

- synchronous ready calls installing no gate;
- receiver and arguments behind independent Promises;
- receiver gate installed before argument waiting;
- later deeper operations waiting behind the gate;
- unrelated operations continuing;
- direct receiver replacement superseding an active call;
- method result independent from gate publication; and
- exact FIFO ordering under repeated calls.

### Rejections

- reachable Promise properties rejected before invocation;
- Promise draft writes rejected;
- private fields and accessors unsupported;
- descriptor, prototype, and extensibility operations rejected;
- internal-slot receivers and children rejected;
- mutation through unproxied arguments or host state documented as a contract
  violation;
- asynchronous or detached proxy access rejected; and
- invariant failures remaining fatal.

## Decision summary

The current runtime graph is data-only. Standard methods and trusted
synchronous registered-class methods are implemented by [`run`](../run.md);
proxy-backed methods for broader classes remain deferred.

If method execution is revisited, ordinary mutating class syntax should use a
recursive operation-local draft proxy rather than requiring class authors to
write Chain path operations. `enter` should own exact receiver capture,
ordering, isolation, and publication; the proxy subsystem should own normal
JavaScript `this` semantics and runtime-aware graph reconciliation.

This combination makes the proxy design cleaner than its predecessor but does
not make it small. Recursive identity handling and finalization remain a
substantial, separately tested subsystem.
