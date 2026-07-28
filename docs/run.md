# `run` Built on Enter/Leave

## Status

This document specifies the planned `run` operation built on [`enter-leave.md`](enter-leave.md).

It replaces the archived proxy/draft proposal. `run` no longer tries to infer native JavaScript mutations and reconcile a graph afterward. A mutating call declares its receiver path up front. A ready direct-safe operation runs there synchronously; any operation that may suspend enters the path, works against a private Chain, and leaves it when complete.

In the initial `run` scope, functions are compiler/runtime operations rather than values read from Cascada variables.

## Supported call kinds

The initial design supports:

1. Side-effect-free standalone functions.
2. Trusted read-only native methods.
3. Language-defined mutating data operations implemented with relative kernel operations, either directly or on an entered Chain.
4. Future CascadaScript methods compiled to the same entered-Chain model.

It does not support arbitrary mutating native JavaScript methods.

That restriction is important. Mutating `enter` solves ordering and ownership transfer, but a raw native method can still bypass Promise mirrors, refcounts, imported data preparation, descriptor rules, and cycle bookkeeping.

## Source-level API

The conceptual source surface remains:

```js
run(path, mutates, ...arguments)
```

`mutates` is a Boolean in the initial version:

- `false`: observe only;
- `true`: the operation may mutate the receiver represented by `path`.

The earlier array-of-property-names scope is deferred. Entering one receiver path is simpler and makes the complete ordering effect visible.

A standalone function is initially selected by the compiler or built-in operation table rather than read as a function value from the graph.

## Kernel entry points

The compiler-facing runtime API should avoid an ambiguous union of path and callable shapes:

```js
runFunction(callable, ...arguments)

runMethod(
    chain,
    receiverPath,
    method,
    mutates,
    ...arguments
)
```

The language/compiler may expose both through one source-level `run` syntax.

`method` is:

- a trusted native read-only method descriptor; or
- a compiler/runtime operation that accepts a Chain and receiver base path.

It is not an arbitrary callable fetched from language data.

A mutating operation descriptor also declares whether it is **direct-safe**: once its receiver and arguments are synchronously available, its complete transition is guaranteed not to wait. This is a trusted compiler/runtime fact, not something inferred by invoking the operation and inspecting its result.

The exact exported names may change, but the implementation should keep function invocation and receiver invocation separate internally.

## Standalone functions

Standalone functions are side-effect-free:

```js
const result = runFunction(functionDescriptor, ...arguments)
```

They may:

- observe their arguments;
- return supported data directly;
- return a Promise producing supported data; and
- return or produce Error values.

They must not:

- mutate arguments;
- mutate closure state or globals;
- perform I/O or DOM mutation;
- retain tracked runtime values;
- receive runtime metadata-bearing objects for later host use; or
- perform any other observable side effect.

Purity is trusted for native host functions. Compiler-defined built-ins should prefer implementations that operate on exported primitives or controlled read-only views.

If argument evaluation is pending, `runFunction` invokes only after all required arguments are available at their captured program positions. It has no effect path to lock because it has no side effects.

The result is direct when invocation and result are synchronous, and a Promise only when argument readiness or the callable result requires waiting.

## String data operations

String operations are pure standalone functions. Examples include:

```text
length
slice
substring
startsWith
endsWith
includes
indexOf
replace
split
toLowerCase
toUpperCase
trim
```

Their exact set and Cascada naming are separate language-design decisions.

They:

- accept string and primitive arguments;
- return strings, numbers, booleans, arrays, or Errors;
- never use `enter`;
- never mutate a receiver; and
- may run as soon as their required arguments are available.

Unsupported types and invalid arguments produce Error values.

## Read-only methods

A trusted read-only method uses:

```js
runMethod(chain, receiverPath, method, false, ...arguments)
```

`runMethod` obtains a read-only Entry:

```js
const entry = enter(chain, receiverPath, false)
```

The Entry captures a stable snapshot and installs no gate. The method observes that snapshot under a temporary read lease. Later live mutations use normal COW and cannot change it. If no overlapping mutation or ordinary sharing occurs, `leave` releases any acquired lease without permanently changing later write behavior. A receiver that is already explicitly shared, imported, or non-extensible needs no redundant lease because it already requires COW.

For native methods, read-only behavior is a trusted host/compiler assertion. The runtime does not use a proxy to detect a lie. A method that mutates its receiver, arguments, globals, or host state violates the contract.

The method must not retain the tracked snapshot after completion. A tracked result passes through normal ownership/export rules and establishes permanent sharing before the read lease is released.

`leave(entry)` closes the read-only Entry directly.

If the method returns a Promise, the lease remains active until that Promise settles and ownership of its result has been established. Detached observation after the returned Promise settles violates the completion contract.

This lifetime restriction is specific to the native method's raw snapshot. Kernel operations issued through `entry.chain` before closure remain valid after `leave`: they performed their available work synchronously and captured pending segments at their own mirror FIFO positions. `runMethod` therefore tracks the native work result, not every issued kernel observation.

## Mutating data operations

A language-defined mutating operation uses:

```js
runMethod(chain, receiverPath, operation, true, ...arguments)
```

The operation has one path-relative ABI:

```js
operation(chain, receiverPath, ...resolvedArguments)
```

It implements every read and write with ordinary kernel operations below `receiverPath`. This same implementation supports both execution modes.

### Synchronous direct path

If all of the following are true:

- the receiver path is synchronously available;
- every required argument is synchronously available; and
- the operation descriptor is direct-safe,

`runMethod` invokes:

```js
operation(chain, receiverPath, ...resolvedArguments)
```

at the call's current program position. It installs no gate, allocates no Entry, and may return directly. This is the normal path for simple synchronous array mutations.

Direct-safe means the operation cannot discover another Promise frontier while running. Operations whose required readiness depends on dynamic or nested data must use the entered path unless their descriptor identifies and captures all such inputs before mutation begins.

### Entered path

Otherwise `runMethod` enters the effect path before waiting or invoking the operation:

```js
const entry = enter(chain, receiverPath, true)
```

The public receiver placement becomes the gate Promise. The same operation is then invoked against the private receiver root:

```js
operation(entry.chain, [], ...resolvedArguments)
```

Every mutation uses existing kernel operations such as:

```js
assignPath(entry.chain, path, value)
deletePath(entry.chain, path)
lookupPath(entry.chain, path)
```

When the operation has issued all of its Entry operations and will issue no more, `runMethod` calls:

```js
leave(entry)
```

Later operations on the public receiver path wait behind the gate. Unrelated paths remain available.

A direct later assignment or deletion at exactly `receiverPath` supersedes the gate immediately; it does not wait. Deeper operations traverse and wait on the gate. If superseded, the private operation still completes and releases its detached gate consumers, but cannot overwrite the newer live property version.

`runMethod` must not invoke an operation on the public receiver and then switch to an Entry merely because the returned value is a Promise. By then the operation may have performed public mutations or retained the wrong receiver for its continuation. Every operation that can suspend uses the entered path from the start.

## Array data operations

Read-only array operations use a read-only Entry or controlled observation. Examples include:

```text
length
at
includes
indexOf
slice
join
```

Mutating array operations use the synchronous direct path when certified direct-safe and currently ready; otherwise they use a mutating Entry. Examples include:

```text
set
append
prepend
pop
shift
insert
remove
splice
reverse
sort
```

The exact language API is separate from this runtime design.

Mutating operations must be implemented through array property transitions on the supplied Chain and relative receiver path. They must not call a native mutating Array method directly on metadata-bearing data.

This preserves:

- sparse holes;
- ordinary-array normalization;
- Promise mirrors for elements;
- assignment of the same Promise as a fresh version;
- Error and refcount behavior;
- aliases and imported ownership; and
- safe `length` handling under the language's array-operation contract.

An entered array operation that needs several element changes may perform them synchronously on the private Chain while the public array remains gated. The changes become publicly reachable together when the Entry leaves. A direct-safe operation performs its complete transition synchronously on the public Chain.

Whether the language exposes these operations as methods, functions, or syntax does not affect the kernel design.

## Argument evaluation order

Source-language argument expressions are captured before the call begins, as in normal call evaluation.

After their positions are captured, a call may take the direct path only when the receiver, arguments, and complete direct-safe transition are synchronously available. Otherwise it enters its receiver before waiting. This is essential:

```text
capture argument positions
enter effect path and install gate
wait for arguments
execute against private Chain
leave
```

If `run` waited for arguments before entering, a later mutation of the receiver could overtake it.

An argument that reads from the same receiver must be captured before the gate is installed. Work after entry that needs receiver data must use `entry.chain`. Waiting through the public gate from inside the operation would deadlock.

Arguments depending on unrelated Promises may resolve normally while the receiver path remains gated.

## Synchronous and asynchronous operations

A direct-safe operation completes synchronously against the public Chain.

An entered operation may complete directly or return a Promise representing its complete work:

```js
const work = operation(entry.chain, [], ...arguments)
```

If `work` is direct, `runMethod` leaves immediately after the synchronous transition.

If `work` is pending because its control flow may issue more Entry operations, the Entry remains active until it settles. Compiler operations must register continuations through runtime Promise helpers rather than raw `.then`.

The operation must not issue detached work that mutates the private Chain after its returned completion has settled.

An already-issued kernel mutation may itself remain suspended on a Promise when the operation finishes. `leave` may publish that graph immediately: the mutation's continuations were registered synchronously before leave, travel with their mirrors, and run before later public consumers at the same frontiers. `run` therefore waits for future operation issuance, not for every issued kernel transition to reach settled data.

This permits asynchronous Cascada operations without making the entire class instance one Promise. Only the declared receiver placement is gated, and the private Chain remains available to the operation.

## Results

`run` has two outputs:

- receiver publication, for a mutating method; and
- the operation result.

They are related but distinct.

A direct-safe mutation returns its operation result directly when receiver and arguments are ready. An entered mutation returns a Promise for completion, even when its private operation is synchronous, because gate publication and the consumers already queued on it complete at a Promise reaction boundary.

For a synchronous direct operation:

1. The operation performs its complete kernel transition on the public Chain.
2. Its result returns directly.

For a synchronous operation on the entered path:

1. The operation computes a result and finishes private mutations.
2. `leave` resolves the receiver gate.
3. Existing gate consumers run in their FIFO batch.
4. The `runMethod` result Promise settles with the operation result after `leave` publication completion.

For an asynchronous operation:

1. The receiver remains gated while work is pending.
2. The operation's work Promise settles with its result.
3. `run` establishes ownership for that result and leaves the Entry.
4. Existing gate consumers run in their FIFO batch.
5. The public `runMethod` result Promise settles after leave publication completion.

Thus, observing completion of an entered `runMethod` guarantees that all operations which registered on its gate before `leave` have completed their synchronous transitions. A later direct replacement may already have detached the gate and remains the live property version.

Tracked results pass through normal ownership rules. A result that aliases the published receiver or one of its children establishes shared ownership.

Standalone and read-only results do not wait for unrelated graph Promises.

## Error behavior

A returned Error is a normal result.

If an entered mutating operation reports an expected Error, it decides whether to:

- leave the current private value and return the Error separately; or
- assign the Error to the private root and publish it with `leave`.

Mutating `run` is not transactional. Mutations already performed on the private Chain are not automatically rolled back when the operation later returns an Error.

A direct-safe operation simply returns its Error result after its synchronous transition; it has no Entry publication decision.

Compiler-generated operations should make their failure behavior explicit.

User data and usage failures become Error values where a result placement exists. Fatal reporting remains reserved for runtime bugs and invariant failures.

## Cancellation

Cancellation cannot simply abandon a mutating call because its gate would remain pending.

A cancellation policy must choose one of:

- leave and publish the private value reached so far;
- assign a cancellation Error to the private root and leave; or
- continue the operation privately until it reaches its normal leave.

The initial implementation should use an explicit Error assignment and `leave`. Silent abandonment is forbidden.

## Repeated calls and loops

Mutating `runMethod` inherits Entry loop behavior.

Sequential code should await receiver publication before entering the same path again:

```js
for await (const item of source) {
    await runMethod(
        chain,
        ["items"],
        appendOperation,
        true,
        item,
    )
}
```

Each iteration creates a fresh gate and mirror. With sequential publication, only one gate remains live and no accumulated Promise tail is stored.

Calls issued ahead of publication queue on the current gate and retain memory proportional to the backlog.

## CascadaScript methods

A future CascadaScript method can use the same mutating orchestration:

```text
enter receiver path
invoke compiled method with private receiver Chain
compiled reads/writes use kernel operations
keep Entry active across method continuations
leave when compiled method completion settles
```

This solves the dependency/effect ordering problem because the public receiver is gated before the method waits on arguments or internal Promises.

The compiled method never re-traverses the public receiver placement, so it does not wait on its own gate.

CascadaScript class state remains subject to compiler guarantees:

- properties are Cascada variables;
- reads and writes use kernel operations;
- reuse uses ownership boundaries;
- no unmarked raw copies are emitted; and
- the supported class subset follows its declared alias/cycle rules.

Class language integration remains separate from implementing `enter` and built-in string/array data operations.

## Native JavaScript classes

Read-only native methods may use the trusted read-only path.

Mutating native methods are not supported initially. Although mutating `enter` provides ordering and can transfer exclusive ownership, direct native writes still bypass:

- Promise-mirror creation and detachment;
- import preparation;
- language descriptor rules;
- refcount and parent-edge updates;
- cycle-cut maintenance; and
- controlled admission of newly assigned host values.

Imported instances also remain aliased with host code.

Supporting mutating native methods would require a separate adapter, export/reimport boundary, proxy, or compiler lowering. `enter` is useful groundwork but is not sufficient by itself.

## Interaction with Promise properties

Language-defined and CascadaScript operations access Promise properties through the private Chain's normal path operations. They retain implicit asynchronous semantics and exact FIFO positions.

Pure native functions and read-only native methods receive only the values defined by their invocation contract. They must not assume that a physical Promise property is already its future value.

No Promise-free receiver precondition is needed for kernel-defined mutating operations because they do not execute opaque JavaScript property reads.

## Implementation boundary

The implementation should live primarily in:

```text
src/run.js
test/run.test.js
```

`run.js` depends on the encapsulated `enter`/`leave` exports from `enter-leave.js` and on generic Promise/result helpers. It never calls either mode's internal path directly. Existing kernel modules do not call `run`.

The only shared instance classification needed later should be added only when CascadaScript class dispatch becomes a real second consumer. No `instance.js` module is needed for pure functions or string/array operations.

String and array operation implementations may live in separate language modules. They receive controlled values or private Chains and do not add special cases to `run.js`.

## Implementation phases

1. Implement and verify the encapsulated `enter` mode selection, temporary read leases, and `leave`.
2. Add pure standalone function invocation and result handling.
3. Add trusted read-only operation/method invocation.
4. Add direct-safe synchronous mutation dispatch.
5. Add entered mutation orchestration with a private Entry chain.
6. Implement initial string data functions.
7. Implement read-only and mutating array data functions.
8. Add cancellation/error policy and loop stress coverage.
9. Only later, define a CascadaScript compiled-method ABI.

Mutating native JavaScript methods and the archived proxy/draft design are not part of these phases.

## Test matrix

Every test runs under inline-Symbol and WeakMap metadata modes.

Functions:

- synchronous and Promise arguments;
- synchronous and Promise results;
- rejection and thrown-value conversion;
- primitive, array, object, and Error results;
- tracked result ownership;
- no effect-path gate; and
- side-effect-free contract documented.

Read-only calls:

- direct and pending receiver acquisition;
- temporary snapshot-lease behavior;
- no redundant lease for an already shared, imported, or non-extensible receiver;
- later live mutation using COW;
- lease release without permanent sharing;
- mutation during the lease preserving snapshot and live copy;
- suspended kernel observations retaining FIFO correctness after lease release;
- native raw-snapshot work keeping the lease until declared completion;
- escaping result permanently shared before release;
- direct and Promise results;
- no gate allocation;
- result ownership; and
- trusted purity limitation.

Mutating calls:

- direct-safe ready operation allocating no gate, Entry, or Promise;
- direct-safe operation returning synchronously;
- pending receiver or argument selecting the entered path;
- non-direct-safe operation entering even when currently ready;
- no post-invocation switch from direct to entered execution;
- identical relative operation behavior at a public path and private root;
- gate installed before waiting for arguments;
- direct and Promise operation completion;
- later receiver traversals and deeper operations waiting;
- unrelated operations continuing;
- receiver publication before later gate consumers;
- direct receiver replacement superseding an active gate;
- private Chain used across continuations;
- result and receiver publication ordering;
- returned Error with leave;
- Error-root publication with leave;
- cancellation;
- no detached private mutation after completion; and
- repeated loop calls retaining O(1) live gates.

Data operations:

- string type and boundary cases;
- sparse and ordinary arrays;
- element assignment/deletion;
- same-Promise element reassignment;
- Promise/Error elements;
- aliases, imported arrays, and COW;
- array length and key order;
- refcounts and verification; and
- exact Error behavior for invalid arguments.

CascadaScript groundwork:

- private receiver operations never traversing the public gate;
- mutation before and after Promise barriers;
- later caller mutations queued behind the method;
- no whole-instance global Promise requirement; and
- automatic leave on every compiler-generated completion path.

## Decision summary

`run` is orchestration around a declared effect path:

- pure functions have no effect path;
- read-only calls capture a temporarily protected snapshot without a gate; and
- ready direct-safe mutations run synchronously on the public Chain;
- other mutating language operations gate the receiver, work through a private Chain, and publish on leave.

This solves ordering before asynchronous work begins and reuses the existing Promise-mirror machinery. It deliberately avoids mutation inference, recursive draft proxies, post-call graph reconciliation, and arbitrary native method execution.
