# Archived Proxy-Based `run` Design

## Status

**Historical predecessor.** This recursive proxy/draft proposal predates the
completed callback-based [`enter`](../enter.md) primitive. Its ordering and
reconciliation analysis informed the newer deferred
[`proxy-plus-enter design`](run.md), but its standalone placement and
publication machinery is no longer the preferred future architecture.

This document is retained because the analysis is the reusable part. It records
why a general `run` operation is expensive under Cascada's ordering model, which
subset stays cheap, and what any future attempt has to solve first. It does not
change the current data-only runtime contract, and no `run` implementation is
planned.

The surface that was proposed, for reference:

```js
run(path, mutates, ...arguments)
```

`path` identifies either a function stored in the language graph or a method
on a class instance. `run` evaluates the callable, receiver, and arguments at
its program position, invokes the callable, commits any permitted receiver
mutation, and returns the callable's result.

The same surface supports two deliberately different implementations:

- a native JavaScript class executes against a temporary identity-preserving
  draft proxy; and
- a CascadaScript class executes compiler-generated Cascada operations and
  does not use a JavaScript draft.

The runtime determines the execution kind from trusted class or method
metadata. Callers do not select it with another Boolean argument.

## Why the proxy design was archived

### One operation, two edges

Every existing kernel operation has its dependency edge and its effect edge on
the same property. `assignPath(chain, ["a","b","c"], v)` waits on `a` because it
must walk through `a`, and any later operation touching `a` walks the same
mirror and queues behind it. The thing an operation waits for is the thing that
serializes its successors, which is why Promise mirrors alone are sufficient for
the whole runtime.

`run` is the first operation where those edges diverge. It waits on a callable,
a receiver, or an argument reached anywhere in the graph, then writes the
receiver subgraph. Nothing connects the two, so no mirror serializes a later
operation against it:

```text
run(["body","move"], true, a.x)       // position 1; a.x is pending
assignPath(chain, ["body","hp"], 5)   // position 2; inputs ready, applies now
```

Sequentially `move()` completes and then `hp` becomes 5. Concurrently the
assignment lands first and `run`'s later commit overwrites it.

This is not fixed by:

- **restricting native methods to synchronous code**, because the delay comes
  from pending inputs, not from the method body;
- **command-buffer issue ordering**, which orders issuance rather than
  execution; two operations waiting on unrelated Promises are unordered by
  design; or
- **pinning the receiver**, which gives `run` the correct issue-time input and
  then silently discards the later write when it commits.

### The device that would work, and why it is native-only

The ordering channel can be restored by making the effect edge pending: when
`run` must defer, write its readiness Promise into the receiver placement. Later
operations then reach a Promise-valued property and register behind it under
rules that already exist, `run`'s commit becomes an ordinary first-resolver
publication, and `readLanguageProperty` stays a physical read.

That works for a native method, whose draft operates on a privately held
receiver and never traverses the placement. It cannot work for a CascadaScript
method, which lowers to ordinary kernel operations on `this` and therefore
reaches the receiver through the same placement: its first write would register
behind a Promise that only that write can resolve.

So the two execution kinds need different ordering strategies. That is a
stronger argument for metadata-based dispatch than the one given below, and it
means the ordering contract itself differs by execution kind.

One further limit: a live mirror requires an own enumerable writable data
property, so a receiver sitting in a frozen imported holder cannot take the
placeholder at all. That case must return an Error or require synchronous
inputs.

### Promises are not confined to arguments

Arguments can at least be enumerated and resolved at their own FIFO positions.
The harder case is the fields a method reads:

```js
move() {
    this.position.coordinates.x += this.velocity.x
}
```

If `velocity` holds a Promise, this computes `NaN` silently. No class author can
assert otherwise, because Cascada may assign a Promise into any field at any
time. The native precondition is therefore a property of the data at one moment,
not a property of the class.

That precondition is at least checkable. After `buildRefIndex(receiver)`,
requiring `promiseCount === 0 && cycleCutCount === 0` proves the reachable
receiver graph is Promise-free; the cut check matters because Promises behind
cuts are not projected. A future attempt should make this a checked precondition
with an attributed Error rather than a trusted assumption.

### The cost that decided it

Native mutating `run` needs, at minimum: recursive draft proxies, post-call
graph traversal, minimal materialized copy sets, placeholder-at-placement
ordering, a Promise-free receiver precondition, no async methods, a carve-out
for non-writable holders, and trusted purity on the read-only path. The payoff
is calling `body.move()` instead of expressing the same mutation in Cascada.

The cheap subset is unaffected by all of it and remains the plausible starting
point if this is ever revisited: standalone pure functions and read-only method
calls resolve their arguments at their own FIFO positions, invoke, and process a
result. No draft, no placeholder, no traversal.

## Goals

`run` should:

- preserve Cascada ordering, ownership, Promise, Error, alias, cycle, and COW
  contracts;
- let ordinary native classes perform useful synchronous mutations, including
  deep mutations;
- permit Promise-valued properties and Promise results;
- let CascadaScript methods suspend and resume with full Cascada semantics;
- preserve ordinary JavaScript identity semantics inside one native method
  call;
- copy only identities affected by a successful native call; and
- keep expected data and usage failures as Error values while reserving fatal
  reporting for runtime bugs and invariant failures.

It should not attempt to turn arbitrary JavaScript side effects into a general
transaction.

## Execution-kind certification

Property-state certification and execution-kind certification answer different
questions:

- `registerDataClass` says an instance can be copied from its own enumerable
  string-keyed state while retaining its prototype.
- An internal `CASCADA_CLASS` or `CASCADA_METHOD` marker says method execution
  is compiler-generated and already uses Cascada operations.

The exact marker name is deferred. It should be an internal runtime/compiler
capability rather than part of the initial package-level API.

Dispatch is conceptually:

```js
if (isCascadaImplementedMethod(receiver, method)) {
    return runCascadaMethod(receiver, method, arguments)
}

return runNativeMethod(receiver, method, mutates, arguments)
```

Class-level certification is simplest when every method in a generated class
uses Cascada semantics. Method-level certification permits mixed classes but
adds classification and inheritance rules. The implementation should choose
one and reject conflicting or forged shapes with an Error value.

Native draft execution requires a registered non-array data class.
Arrays may participate as data below a native receiver but do not acquire
class-method preservation during COW.

## Common path and callable resolution

For a method path, the final segment is the method name and the preceding
segments resolve the receiver. Method lookup is deliberately separate from
language-property lookup because methods normally live on prototypes and
prototypes are not language graph data.

Native method lookup must:

- inspect data descriptors without invoking getters;
- support inherited and overridden methods;
- walk only the permitted certified prototype chain;
- stop before unapproved intrinsic prototypes;
- require a callable data-property value;
- reject constructors;
- define whether an own enumerable field shadows a prototype method; and
- return an Error for a missing, accessor, forbidden, or non-callable method.

The recommended shadowing rule is ordinary JavaScript shadowing: an own
language property with the requested name wins. If it is not callable, the
call is an Error rather than falling through to a prototype method.

A function stored as an own language property is invoked as a standalone
function unless the language explicitly selected method syntax. Standalone
functions are always trusted side-effect-free calls and have no receiver or
argument mutation scope. Passing `true` or an array for `mutates` is an Error;
the valid form is:

```js
run(functionPath, false, ...arguments)
```

The receiver, callable, and arguments may themselves be reached behind
Promises. The runtime registers at the exact call position and invokes only
when the required values are available. The returned `run` result remains
pending until invocation and any returned result Promise finish. Several calls
waiting on the same source retain the existing FIFO continuation rules.

The compiler must distinguish ordinary implicitly asynchronous arguments from
an intentional opaque Promise value. The initial design resolves ordinary
Cascada arguments before invoking native JavaScript.

## Native JavaScript execution

### Why direct invocation is unsafe

Calling a native method directly on tracked data bypasses the mutation kernel:

```js
body.move()
```

The method can write properties without creating Promise mirrors, updating
refcounts, preparing imported values, detecting cycles, or protecting shared
owners. Shallow-copying only the receiver is insufficient:

```js
move() {
    this.position.coordinates.x += this.velocity.x
}
```

If `position` remains shared, the original graph changes.

Native methods therefore execute against an operation-local recursive draft.
The draft provides ordinary JavaScript identity during the synchronous call
while isolating intercepted changes until reconciliation succeeds.

### Mutation declarations

The native forms are:

```js
run(path, true, ...arguments)
run(path, ["position", "velocity"], ...arguments)
run(path, false, ...arguments)
```

`true` permits mutation of the receiver and every supported language identity
reachable from it.

An array declares selected receiver roots:

- each named direct receiver property may be assigned or deleted;
- every supported identity reachable from a named property is mutable;
- permission is based on identity, not the path later used to reach it; and
- other direct receiver properties cannot be assigned or deleted.

For:

```js
this.position === this.alias
run(path, ["position"])
```

both of these address the same permitted identity:

```js
this.position.x = 10
this.alias.x = 10
```

The direct receiver remains special. Listing `position` permits replacing
`this.position`; it does not permit replacing `this.alias` merely because both
currently contain the same identity.

`false` is a trusted read-only fast path. It invokes the method on the original
receiver, creates no draft, performs no COW, and processes only the result.
This is the simplest native form and need not be delayed.

The runtime cannot enforce this declaration without using the full proxy
machinery. A native method falsely declared read-only can mutate shared or
imported data without detection, so purity is a trusted compiler/host
assertion. A future checked-read mode could use a rejecting proxy if needed.

The larger hazard is escape rather than mutation. With no draft, `this` is the
tracked instance itself, metadata and all. The method can retain it in a
closure, a global, or a returned structure and use it after the call, which
contradicts the rule that host code receives exported data rather than a
tracked receiver. A deferred read-only call also reads the live receiver late
and can observe later in-place writes; requiring synchronous availability for
`mutates: false` keeps the trusted path from also being an ordering exception.

These declarations express permission, not an assertion that every permitted
property will change.

### Identity-based scope validation

One canonical draft proxy represents each source identity, so permission
cannot depend on which alias produced the proxy.

Selected-scope writes may be recorded tentatively and validated after the
synchronous call. The permitted identity set is the union of identities
reachable from the selected roots in:

- the original receiver graph; and
- the final draft graph.

This permits replacing a selected property with a new graph and then mutating
that graph. It also permits mutating an original selected child before later
replacing or deleting its receiver edge. A changed identity that is neither
originally nor finally reachable from a selected root is outside the scope.

The receiver is a scope boundary. If selected traversal reaches it through a
back-reference, the traversal records that edge for alias/cycle reconstruction
but does not expand through the receiver's other properties. Otherwise:

```js
this.position.parent = this
```

would accidentally make every receiver property mutable under
`["position"]`.

Every direct receiver write is validated separately against the listed keys.
Any invalid write discards intercepted changes and produces an Error result.

The implementation must retain an ordered write log or equivalent final draft
state sufficient to validate assignment, deletion, creation, array length, and
property-order effects.

### Lazy recursive draft

Access must not itself copy data:

1. Create a draft state and proxy for the receiver.
2. Reading a supported tracked child returns its canonical draft proxy.
3. Reads use the current draft view, falling back to the logical source value.
4. A write or deletion records an override on that draft identity.
5. Later reads through every alias observe the recorded override.
6. When the synchronous call ends, reconcile the draft into runtime data.
7. Revoke every draft proxy.

For:

```js
this.position.coordinates.x = 10
```

the call behaves conceptually as:

```text
read position       -> position proxy, no copy
read coordinates    -> coordinates proxy, no copy
write x              -> record coordinates.x = 10
```

No deep comparison is needed. Every intercepted assignment, creation, or
deletion is a semantic mutation even when the final value is `===` to the
original. In particular, assigning the same Promise creates a fresh property
version and mirror. Delete-and-reinsert can also change key order. The runtime
does not attempt to collapse recorded writes.

### Draft identity

One operation-local `WeakMap` maps every original identity to one draft state
and proxy. A second map may be needed for newly assigned identities.

Draft state conceptually contains:

```text
source
proxy
direct overrides
deleted keys
write log
execution permission
reconciliation state
final value
```

Draft state is not Cascada META. It belongs only to one `run` operation.

Within the method:

```js
this.left === this.right
```

remains true when both properties originally refer to the same identity.
After:

```js
this.left.x = 10
```

reads through `right` observe `10`, and the finalized graph keeps both aliases
pointing at the same finalized identity.

This is intentionally ordinary JavaScript graph-identity behavior. It differs
from a standalone Cascada path assignment, which copies one path rather than
an entire aliased identity. A native `run` call is one graph transaction, not
a lowering to several independent Cascada assignments.

### Proxy target and invariants

The proxy cannot blindly use an arbitrary source object as its target.
JavaScript proxy invariants can forbid returning a child proxy in place of a
non-configurable, non-writable source property.

The likely design uses an unobservable synthetic target with the correct broad
shape:

- `{}` for a plain-object draft;
- `Object.create(null)` for a null-prototype draft;
- `[]` for an array draft; and
- `Object.create(prototype)` for a registered data-class draft.

The handler must keep `get`, `set`, `deleteProperty`, `has`, `ownKeys`,
`getOwnPropertyDescriptor`, `getPrototypeOf`, and relevant array behavior
consistent with the synthetic target's invariants.

The supported reflective subset must be explicit. The initial version should
reject descriptor mutation, prototype mutation, sealing, freezing, and
extension-state changes with Error values.

All proxies are revoked immediately when synchronous invocation and result
capture finish, whether the call succeeds or fails. A proxy must never enter
the committed graph or remain usable by delayed code.

## Post-call reconciliation

### Why traversal is required

Proxy access records cannot discover an alias the method never reads:

```js
this.left.x = 10
// this.right also points at left, but the method never reads right
```

Preserving JavaScript alias semantics requires finding and updating the
`right` edge. Therefore a successful call with recorded writes performs a
complete cycle-safe traversal of the relevant receiver graph.

The proxy minimizes copying, not worst-case discovery:

```text
no intercepted writes:  O(properties accessed), original receiver retained
intercepted writes:     O(relevant graph traversal + affected-node copying)
```

The runtime may skip reconciliation entirely when there were no writes and no
returned draft identity requires finalization.

### Graph collection

Traversal reads the final draft view, not only the original graph. It collects:

- every reachable supported identity;
- final own enumerable string-keyed edges;
- reverse parent edges;
- selected-scope reachability;
- directly changed identities;
- newly assigned identities;
- aliases;
- cycles; and
- synchronous returned draft identities that must also be finalized.

Traversal uses runtime logical property reads where mirrors exist. It must not
copy metadata or invoke accessors.

The implementation keeps three concepts separate:

- **permitted identities** are reachable from original or final selected roots
  under the receiver-boundary rule;
- **directly changed identities** have recorded assignments or deletions; and
- **materialized identities** are changed identities reachable from the final
  receiver or a synchronous returned draft root, plus the containers required
  to reconnect them.

A permitted child that is mutated and later detached need not be materialized
unless it is also returned. Its isolated draft work can be discarded.

Opaque unsupported values may remain as unchanged leaves, but the native
method must not receive a raw mutable reference that could bypass the draft.
The initial implementation should return an operation-local guard proxy for
Map, Set, Date, RegExp, typed arrays, Errors with mutable custom properties,
and similar leaves. Whole-property replacement remains allowed, while internal
mutation or unsupported reflective access produces an Error.

### Minimal copy set

The directly changed identities seed a copy set. Reverse parent propagation
adds every container that must point to a finalized changed identity. This
continues to the receiver and to any synchronous returned draft root.

Consequently, "copy only changed values" means:

> Copy directly changed identities and every container required to reconnect
> all final aliases to those identities.

Unchanged scalar properties and child identities outside the copy set are
reused.

For:

```text
receiver
|-- position
|   |-- coordinates  <- x changed
|   `-- metadata
`-- velocity
```

the copy set is normally:

```text
receiver
position
coordinates
```

`metadata` and `velocity` retain their original identities.

If two receiver properties point at one changed child, the receiver is copied
once and both final properties point at the same child copy.

### Aliases and cycles

The runtime already accepts aliases and cycles as language data. Permanently
forbidding them only for runnable classes would be surprising and would still
require traversal to detect violations.

The preferred final design supports arbitrary aliases and cycles through a
two-pass graph transformation:

1. Collect the final draft graph and reverse edges with identity maps.
2. Propagate the copy set backward from directly changed identities.
3. Allocate a shell for every identity in the copy set before populating any
   shell.
4. Populate each shell from the final draft view.
5. Point an edge to the allocated shell when its final child is in the copy
   set; otherwise reuse the final original child.
6. Rebuild runtime mirrors, cuts, counters, parents, and import status.

Preallocating shells supports self-cycles, cycles back to the class root, and
multi-node cycles without recursive looping.

A deliberately smaller first implementation may reject every cycle with an
Error, but "only cycles back to the class root" is not recommended as a
permanent rule. Once graph collection and shell preallocation exist, arbitrary
cycles are clearer than a special cycle grammar.

### Runtime-aware construction

Reconciliation cannot use `structuredClone`. It must use Cascada's data model:

- plain objects become local plain objects;
- null-prototype records retain `null`;
- arrays and array subclasses become local ordinary arrays with the same
  length;
- certified non-array native classes retain their exact prototypes;
- only own enumerable string-keyed properties are language data; and
- constructors are never invoked.

It must also preserve runtime behavior:

- assigning a Promise creates a fresh mirror;
- retaining or copying a Promise property forks or reconstructs its mirror at
  the call's program position;
- imported retained children keep their effective attribution;
- reused tracked children are marked shared;
- assigned external values enter through the required import boundary;
- Error identities remain correct;
- aliases and cycles retain their final topology;
- cycle cuts and reverse parent edges are rebuilt;
- indexed output receives correct counters; and
- runtime metadata itself is never copied as language data.

The implementation should extract and reuse existing shell and transition
primitives rather than create a second definition of language copying.

### Commit

Reconciliation constructs an unobservable finalized receiver. A successful
native call then applies ordinary Cascada COW from the first shared ancestor
on the receiver's owning path and installs the finalized receiver at that
path. The receiver replacement is one synchronous program transition; it must
never directly mutate a shared or imported owner.

If the receiver is aliased outside the selected owning path, those outer
aliases retain the original instance under Cascada's normal path-COW rules.
Aliases inside the receiver graph retain the native call's JavaScript identity
semantics and point at the appropriate finalized identities.

If the receiver did not change, its original identity is retained.

If validation, reconciliation, or supported usage fails, `run` returns an
Error and does not commit the draft. Fatal reporting is reserved for runtime
bugs and invariant failures.

This transaction guarantee covers only intercepted draft state. It cannot
undo I/O, global mutation, closure-captured mutation, DOM changes, or writes
through unproxied arguments.

## Promise-valued properties

Registered data classes may contain Promise-valued properties.

A native method may synchronously:

- read and return the Promise object;
- pass it to synchronous code as a Promise;
- replace it with another Promise or ordinary value;
- assign a new Promise property; or
- delete the property.

Reconciliation routes every final Promise placement through normal mirror
birth, fork, detachment, import, and refcount rules.

Opaque native JavaScript does not receive implicit access to a Promise's future
value:

```js
useResult() {
    return this.result.value
}
```

If `result` is a Promise, JavaScript sees a Promise. The runtime cannot suspend
and restart an opaque native method because its synchronous prefix and external
effects would execute twice.

To mutate from a resolved result, Cascada code should issue a later call with
the resolved value as an argument:

```js
finish(result) {
    this.result = result
    this.status = "finished"
}
```

Promise-valued fields therefore remain supported data without making native
methods implicitly suspendable.

## Promise-returning native methods

**Deferred.** Banning async native methods is a worthwhile cut on its own — it
deletes this entire section, the post-return revocation contract, the
draft-proxy-in-result restriction, the detached-timer discussion, and roughly a
fifth of the test matrix. It does not fix the ordering problem above, because
that delay comes from pending inputs rather than from the method body. Promise
*properties* remain readable and replaceable either way, since that needs no
suspension. The rest of this section records the design that would be needed if
async methods were ever allowed.

A native method may return a Promise. Returning a Promise is distinct from
performing delayed receiver mutation.

For:

```js
async calculate() {
    this.status = "started"
    const input = this.input
    const result = await calculate(input)
    return result
}
```

the synchronous prefix mutates the draft and captures `input`. When the method
returns its Promise:

1. `run` captures the result Promise.
2. It finalizes and commits the synchronous draft changes.
3. It revokes every draft proxy.
4. The result remains pending.
5. Fulfillment becomes the `run` result at the call's result position.
6. Rejection becomes a language Error value.

The later Promise result cannot roll back already committed synchronous
mutation.

After the native method returns its Promise, it must not access the receiver,
any nested draft proxy, or any value derived as a draft proxy:

```js
async invalid() {
    await something
    this.status = "finished"
}
```

Even a delayed read is invalid because the proxy has been revoked:

```js
async invalid() {
    await something
    return this.status
}
```

Capturing ordinary data before suspension is valid:

```js
async valid() {
    const status = this.status
    await something
    return status
}
```

The runtime cannot generally prove that delayed code has no external side
effects. This is a trusted native-method contract. Revocation detects later
draft access but cannot undo unrelated host effects.

If delayed draft access occurs inside the returned Promise chain, that Promise
rejects and `run` converts the rejection to an Error result. A detached timer,
microtask, event handler, or unreturned Promise has no remaining `run` result
channel. Its later revoked-proxy failure is an unsupported host-side failure;
it is not a runtime invariant bug, but it cannot replace the already completed
call result.

Initially, a Promise result must not fulfill with a draft proxy or a graph
containing draft proxies. Supporting that would require delayed translation
from revoked draft identities to finalized identities and a cycle-safe scan of
the fulfilled graph. An exact top-level known proxy can be detected through
operation state. The simplest initial contract permits primitive, Error, and
ordinary proxy-free fulfillment values; recursively embedded draft proxies
remain unsupported until result sanitization is designed.

## Synchronous results and ownership

A synchronous result may be:

- a primitive;
- an Error;
- an ordinary tracked value;
- the receiver draft; or
- a nested draft identity.

Known draft identities are translated to their finalized identities before
proxies are revoked. Reconciliation treats such results as additional roots
when necessary.

If the returned finalized value is also retained inside the committed
receiver, it now has multiple owners and must be marked shared before either
owner can mutate. All other tracked results pass through the normal ownership
and import rules.

User-thrown JavaScript exceptions become Error results and discard intercepted
draft changes. Non-Error thrown values need the same normalization policy used
for rejected data Promises. Unexpected runtime invariant failures remain
fatal.

Returning an Error is not throwing:

```js
return new Error("result") // successful call; commit intercepted changes
throw new Error("failure") // failed call; discard intercepted changes
```

A Promise that fulfills with an Error likewise succeeds with an Error value.
A Promise rejection becomes an Error result without rolling back synchronous
changes committed when the Promise was returned.

## Native-method limitations

A runnable native class remains a registered data class. Meaningful behavior
must not depend on:

- JavaScript `#private` fields;
- Symbol-keyed or non-enumerable state;
- instance or prototype accessors used as state;
- closure-captured identity-specific state;
- hidden shared mutable storage; or
- native internal slots.

A proxy used as `this` does not carry the target's private-field brand.

All supported mutation must pass through the receiver proxy or a child proxy
obtained from it. Mutation through closure-captured references, globals, DOM
objects, I/O, or unproxied arguments is outside the draft transaction.

Initially unsupported operations include:

- `Object.defineProperty` and descriptor mutation;
- `Object.setPrototypeOf`;
- `Object.preventExtensions`, `Object.seal`, and `Object.freeze`;
- Symbol-keyed or non-enumerable mutation;
- getters and setters with arbitrary behavior;
- native internal-slot mutation such as `Map.prototype.set`,
  `Set.prototype.add`, or `Date.prototype.setTime`;
- storing a draft proxy outside the synchronous call;
- draft access after the native method returns;
- re-entrant or nested native `run` unless explicitly designed; and
- mutating ordinary object arguments.

Map, Set, Date, RegExp, typed arrays, and similar values may remain unchanged
opaque leaves or be replaced as whole property values. Mutating native methods
are blocked by their guard proxies. Their internal mutation requires dedicated
adapters and is deferred.

Normal enumerable property reads, assignments, creation, deletion, nested
object mutation, array mutation, aliases, cycles, Promise property replacement,
and synchronous method-to-method calls are intended to work.

## CascadaScript class execution

A CascadaScript class does not use the native draft rules.

Its compiler guarantees:

- instance properties are Cascada variables;
- reads, writes, deletes, and calls use kernel operations;
- reuse passes through ownership marking;
- no unmarked raw copies are emitted;
- CascadaScript class state is acyclic under the current language subset;
- method continuations register at exact Promise positions; and
- every supported mutation is expressed through the runtime rather than an
  opaque JavaScript side effect.

A CascadaScript method may safely suspend and mutate later:

```js
async finish() {
    this.result = await this.pending
    this.status = "finished"
}
```

The compiler lowers the wait and subsequent assignments into ordered Cascada
continuations. No JavaScript proxy remains live across the suspension, and the
whole instance does not need to become one Promise.

`mutates` for a CascadaScript method is compiler metadata rather than a native
draft scope. The compiler may use it for static validation, optimization, or
calling convention selection. The kernel should not trust a caller-provided
mode to reinterpret opaque native JavaScript as compiled Cascada code.

CascadaScript methods retain Cascada's normal path-COW semantics unless the
language definition explicitly gives a class method different identity
semantics. They do not automatically inherit the native draft's graph-
transaction alias behavior.

The precise compiled method ABI, result holder, continuation representation,
and interaction with language-level exceptions belong to the language
integration design.

### Suspension ordering

The command buffer orders issuance, not execution, so a suspending method has
the same inversion risk as a native one — but only for the same property:

```text
method, after suspension:  this.hp = 10
caller, next position:     body.hp = 5
```

Sequentially 5 wins; concurrently 10 does. If the method writes `result` and
`status` while the caller writes `hp`, the final state is identical either way
and nothing is violated. The hazard needs a same-property collision across a
suspension boundary, which makes its scope much narrower than it first appears.

Two shapes could close it:

- a per-property claim, where each suspension point claims the method's static
  may-write set so later caller operations queue behind it; over-approximating
  through branches costs serialization, not correctness; or
- private-receiver lowering, where the compiler emits kernel operations against
  a captured instance instead of re-walking the path. The method can then hold
  the receiver placement pending and commit once at completion, with no
  deadlock and no proxy, because it never traverses that placement. This is the
  native model without its expensive half, at the cost of serializing readers
  for the method's whole duration.

Either way this is compiler work rather than kernel work, which is why
CascadaScript classes remain the more plausible of the two execution kinds.

## Standalone functions

Standalone functions are simpler because they have no receiver draft.

The function contract is:

- `mutates` must be `false`;
- the function is trusted to have no observable side effects;
- arguments are observational inputs and must not be mutated;
- closure state, globals, I/O, DOM state, and other host state must not be
  mutated;
- primitive and read-only arguments;
- synchronous or Promise results;
- rejection conversion to Error values;
- tracked-result import and ownership handling; and
- exact program-position invocation.

The initial implementation does not use draft proxies for standalone
functions. Purity is a trusted compiler/host assertion; arbitrary JavaScript
side effects cannot be detected. A function that mutates a tracked argument or
other host state violates the contract. Argument mutation is not a deferred
`run` feature unless the language later introduces a separate operation with
explicit mutation semantics.

## Errors and fatal failures

Expected data and usage problems return Error values whenever `run` has a
result position. Examples include:

- missing receiver or method;
- non-callable path;
- forbidden constructor or accessor;
- uncertified native receiver;
- mutation outside the selected scope;
- unsupported descriptor or prototype operation;
- attempted mutation of an opaque native internal-slot value;
- delayed access to a revoked draft when the failure flows through the returned
  Promise;
- unsupported Promise result containing draft proxies; and
- user-thrown values.

Runtime bugs and invariant failures remain fatal. Examples include:

- corrupt mirror or refcount state;
- an impossible parent/copy-set relationship;
- a draft proxy entering a committed graph despite finalization checks; or
- an unexpected failure inside a transition already validated by the kernel.

Only intercepted draft changes are discardable. Returning an Error does not
promise rollback of arbitrary host side effects.

## Suggested implementation architecture

Keep native and CascadaScript execution separate below the shared resolver:

```text
run
|-- resolve callable, receiver, arguments, result position, and owner path
|-- dispatch certified execution kind
|
|-- native read-only
|   `-- trust purity, invoke original receiver, process result only
|
|-- native mutating
|   |-- create operation-local draft proxies
|   |-- invoke synchronous prefix
|   |-- capture direct value or Promise result
|   |-- validate scope
|   |-- collect final graph and reverse edges
|   |-- compute materialized copy set
|   |-- allocate and populate runtime-aware shells
|   |-- COW the receiver's owning path and commit once
|   |-- translate synchronous draft results
|   `-- revoke every proxy
|
`-- CascadaScript
    `-- enter compiler-generated continuation ABI
```

### Isolation and kernel boundary

The subsystem should be isolated in `src/run.js` and, only if its private draft
logic becomes too large, a companion such as `src/run-native-draft.js`.
Existing import, observation, mutation, mirror, refcount, metadata, and export
modules must not call into `run`. The dependency direction is one-way: `run`
uses generic kernel primitives.

Shared instance capabilities belong in one small neutral `src/instance.js`,
not a premature `src/class/` hierarchy. It owns only property-state
certification, CascadaScript-instance certification, and execution-kind
classification. `mutations.js` and `run.js` may depend on it; it contains no
method lookup, invocation, draft, Promise, or COW logic. Standalone functions
do not use it.

One narrow kernel integration is necessary. A suspended call cannot safely do:

```js
const receiver = lookupPath(chain, receiverPath)
// invoke later
assignPath(chain, receiverPath, finalizedReceiver)
```

The second operation would start a new traversal and could target state that
replaced the property version originally captured by `run`. The kernel must
instead expose an internal generic captured-location/path-transform primitive.
It resolves at the call's exact program position and supplies controlled
replacement through that same root, nested, or detached placement, including
owning-path COW and import attribution.

This primitive must know nothing about methods, proxies, or drafts. It may live
with mutation-path walking and need not be exported from `src/index.js`.
Likewise, shell selection may be exposed as one internal helper or moved to a
small neutral module; `run` must not duplicate object/class/array
classification.

Native draft machinery should be operation-local. Reusable runtime helpers may
be extracted for:

- shell selection;
- logical property enumeration and reads;
- unobservable property population;
- Promise mirror reconstruction;
- import attribution;
- copy-set refcount construction; and
- atomic receiver placement.

Do not expose a generalized container-dispatch framework merely to implement
the first version.

## Suggested implementation phases

These phases describe the full design as originally scoped. Only phase 1 was
the cheap subset; everything from phase 2 onward carries the costs listed in
"Why the proxy design was archived", and phase 7 disappears if async native
methods stay banned.

1. Shared path/callable resolution, trusted read-only native methods, and
   side-effect-free standalone functions with `mutates: false`, including
   Promise results.
2. Native certified methods with `mutates: true`, direct receiver writes,
   owning-path COW, and synchronous results.
3. Recursive native drafts for tree-shaped ordinary objects and arrays.
4. Post-call graph collection, aliases, arbitrary cycles, and minimal
   materialized copy-set reconciliation.
5. Selected identity-based mutation scopes with receiver-boundary traversal.
6. Promise-valued fields, Promise mirror reconstruction, imported attribution,
   refcounts, cuts, and full verifier integration.
7. Promise-returning native methods with immediate draft commit and revocation.
8. CascadaScript execution-kind certification and compiled method ABI.
9. Only after demonstrated need, checked read-only calls, promised
   draft-derived results, selected native adapters, or nested `run`.

Intermediate phases that cannot safely accept the runtime's full data domain
must reject unsupported shapes with Error values rather than silently violate
ownership.

## Test matrix

Every applicable test runs under inline-Symbol and WeakMap metadata modes.

### Resolution and dispatch

- standalone functions and native methods;
- standalone functions accepting only `mutates: false`;
- `true` or array mutation declarations on standalone functions returning
  Error;
- trusted function purity and argument immutability documented;
- class-level or method-level Cascada certification;
- forged, missing, and conflicting execution markers;
- own method shadowing;
- inherited and overridden methods;
- getter-free descriptor lookup;
- missing paths, non-functions, and constructors;
- receiver, callable, or argument behind one or several Promises; and
- FIFO ordering among calls and ordinary operations.

### Native synchronous execution

- correct `this` binding and arguments;
- direct assignment, deletion, and missing-key creation;
- one-level and deeply nested writes;
- several independent changed paths;
- reads causing no copies;
- assignments of the original scalar value still counting as writes;
- same-Promise assignment creating a fresh property version;
- key deletion and reinsertion order;
- arrays, sparse arrays, and array length;
- null-prototype records and registered data classes;
- array subclasses normalized during finalized copying;
- enumerable `__proto__`, `constructor`, and method-name data keys;
- synchronous method-to-method calls; and
- every proxy revoked after success or failure.

### Scope and identity

- `mutates: true`;
- selected direct receiver replacement and deletion;
- deep mutation beneath selected roots;
- writes to unlisted receiver keys rejected;
- one identity reachable through selected and unselected aliases;
- newly assigned graphs beneath selected roots;
- detached originally selected graphs;
- a selected child back-reference to the receiver not widening scope;
- invalid mutation laundered through a temporary alias rejected;
- no-write calls retaining the original receiver; and
- final scope validation independent of property access order.

### Graph reconciliation

- only changed identities and required containers copied;
- unchanged siblings reused and marked correctly;
- aliases discovered and undiscovered during execution;
- aliases to changed and unchanged identities;
- several aliases through several selected roots;
- outer aliases to the receiver retaining ordinary Cascada path-COW behavior;
- self-cycles, root back-references, and multi-node cycles;
- cycles crossing selected and unselected roots;
- permitted, directly changed, and materialized identity sets remaining
  distinct;
- directly changed nodes later detached and not materialized unless returned;
- changed draft identities returned synchronously;
- source isolation;
- no proxy or draft metadata leakage; and
- cycle-safe finalization with one shell per copied identity.

### Promises and results

- existing Promise properties read as Promise objects;
- Promise property assignment, replacement, deletion, and same-Promise
  reassignment;
- correct mirror creation or forking at the call position;
- synchronous primitive, Error, receiver, child, and external tracked results;
- returned values aliased with committed receiver state becoming shared;
- Promise-returning native methods committing their synchronous prefix;
- fulfillment and rejection after immediate proxy revocation;
- captured primitive data used after `await`;
- receiver or child access after `await` rejected;
- detached timer or microtask access having no completed-call Error channel;
- exact and recursively embedded draft proxies in Promise results rejected;
- later result rejection not rolling back committed synchronous mutation; and
- no Promise result waiting on unrelated graph Promises.

### Runtime integration

- imported source isolation and attribution;
- assigned external values prepared correctly;
- shared/imported ancestors above the receiver COWed before commit;
- opaque Date, Map, Set, typed-array, and Error mutation guarded;
- Error identities and Error queries;
- counters, reverse parents, cuts, and verifier agreement;
- method throws returning Error without draft commit;
- a returned Error committing changes while a thrown Error discards them;
- unsupported usage returning Error without partial runtime metadata;
- runtime invariant failures remaining fatal;
- both metadata storage modes; and
- synchronous transition ordering around earlier and later suspended
  operations.

### CascadaScript methods

- automatic dispatch without a caller execution-mode flag;
- ordinary and Promise-sensitive property reads;
- mutation before and after Promise barriers;
- compiler-defined mutation metadata;
- compiler-enforced acyclic class state and no unmarked raw copies;
- class inheritance and method dispatch;
- language Error and result semantics;
- normal Cascada ownership and path-COW behavior; and
- no native proxy allocation.

## Recorded review findings

Smaller items from the design review, kept so a future attempt does not
rediscover them.

**Correctness and consistency**

- A CascadaScript class needs `registerDataClass` in addition to its execution
  marker, because its compiler-emitted mutations still route through
  `createCopyShell`. The compiler or runtime integration must register every
  generated class before its instances enter Cascada.
- Reconciliation normalizes array subclasses into ordinary arrays. Step 20's
  `createCopyShell` now does the same, so the two agree today; they must stay
  aligned, because one shape must not have two behaviors depending on which
  operation reaches it.
- A nested read through a pending Promise silently yields `undefined` rather
  than suspending or failing: `this.a.b` where `a` is pending reads a property
  of a Promise object. This is the sharpest divergence from Cascada semantics
  inside a native call, and it fails quietly.
- `mutates` means a kernel-enforced draft scope on the native path and inert
  compiler metadata on the CascadaScript path. State that the kernel ignores it
  for CascadaScript dispatch.
- Path resolution should follow `walkObservationPath` semantics: an existing
  Error on the receiver path propagates, while a broken prefix mints a new
  path-access Error.
- The receiver-boundary rule needs both halves to be safe. Permitted-set
  traversal must stop at the receiver, and every direct receiver write must be
  validated separately against the listed keys.

**Simplifications**

- The ordered write log is probably unnecessary. The final draft view is
  authoritative for content and key order, and scope validation needs only
  which keys changed, not the order in which they changed.
- Guard proxies for opaque leaves contradict the trust posture used everywhere
  else here. Treat internal mutation of a Date, Map, Set, or typed array as a
  trusted-contract violation, and move guard proxies to the same late phase as
  checked read-only calls.
- A separate `src/instance.js` for three certification predicates is premature
  while `run` does not exist. Leave certification where it is until a second
  consumer appears.
- The array form of `mutates` is validated post hoc: the method has already
  mutated the draft, and validation only rejects the commit. Against a model
  that already trusts the method not to perform I/O, its containment value is
  modest relative to identity sets, union reachability, and the
  receiver-boundary rule.

**Feature gaps**

- Accessors are rejected, so `get length()` is unusable while an equivalent
  `length()` method works. Computed views are a large part of what preserving
  prototypes buys; if accessors stay excluded, the reason should be recorded.

## Decision summary

This proxy-based native-mutation design is archived. The analysis that produced
that decision:

- `run` is the first kernel operation whose dependency edge and effect edge are
  different properties, so Promise mirrors alone cannot order it against later
  operations. Restoring the ordering channel means making the effect edge
  pending, and that device works only for native methods.
- Native mutating calls additionally require a Promise-free receiver graph,
  which is a property of the data at one moment rather than of the class. It is
  checkable through the existing counters, but it is not something a class
  author can assert.
- The remaining machinery — draft proxies, post-call traversal, materialized
  copy sets, revocation, and the limitation list — is large relative to the
  payoff of calling a method instead of expressing the same mutation directly.
- CascadaScript methods remain the more plausible kind. Their difficulty is
  real but narrower: same-property collisions across a suspension boundary,
  solvable in the compiler rather than the kernel.

The cheap subset survives all of this. Standalone pure functions and read-only
method calls need argument resolution at FIFO positions, invocation, and result
handling — no draft, no placeholder, no traversal. If `run` is ever revisited,
that is where it starts.
