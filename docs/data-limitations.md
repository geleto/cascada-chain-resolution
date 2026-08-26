# Data and Host-Code Limitations

This is the authoritative developer-facing contract for data passed between JavaScript and Cascada. The runtime may reject unsupported data, but restrictions on native code are trusted contracts unless stated otherwise.

## Terms

- **Managed data:** data whose complete logical state Cascada can traverse, resolve, copy, and isolate. Records and Arrays are managed by default; declared class instances can also be managed.
- **External state:** an exact host identity whose live state Cascada does not copy or manage. Class instances are external by default; a record or Array can be declared external.
- **Host code:** JavaScript methods, accessors, callbacks, and other functions invoked across the Cascada boundary.
- **Controlled method:** a runtime implementation, such as a supported logical Array method, that operates directly on logical Cascada data rather than arbitrary host state.

## Graph-visible data

Cascada graph state consists only of own enumerable string-keyed data properties.

- Records expose those properties.
- Arrays expose canonical indexes. Length and holes retain Array semantics, but custom properties are outside the graph.
- Symbols, inherited properties, non-enumerables, accessors, prototypes, private fields, and native internal slots are outside the graph.
- An accessor or non-enumerable property is treated as absent. Cascada does not invoke it as managed graph data.
- Paths use String or Number segments. Other resolved segment values are invalid and are never coerced through user hooks.
- Aliases, cycles, sparse Arrays, Functions, Errors, external identities, and nested Promises are supported unless a narrower rule below excludes them.

Do not place semantic managed state outside graph-visible properties. Cascada may copy or materialize managed data without copying hidden state or preserving traversable identity between operations.

## Executable positions

- A Function is data unless a supported method or callback position explicitly selects it for execution.
- `constructor` is never a callable method through `run`.
- Strings support documented native observations only.
- Number, Boolean, BigInt, Symbol, `null`, and `undefined` have no methods or property writes.
- A Promise has no direct operations; the resolved value determines its capabilities.
- An Error has no operations and propagates as language data when consumed.

## Classification and declarations

Records and Arrays default to managed. Class instances default to external.

- Call `externalState(value)` before admission to make one exact record, Array, or class instance external. The declaration is shallow and overrides `managedStateClass` for that identity.
- Call `managedState(value)` before admission to make a class instance managed. When given unadmitted managed data, it also declares reachable class instances until it reaches existing managed or external boundaries.
- Call `managedStateClass(...classes)` to make subsequently admitted instances of those exact classes managed. The rule is not inherited by subclasses.
- Classification becomes permanent at first admission. Later declarations and class-registry changes cannot reclassify an identity.
- Repeating the same declaration is allowed. A conflicting declaration returns a validation Error without changing the established category.
- Declaration APIs are synchronous and never await. Do not pass them a Promise or callable thenable. `externalState` also rejects Functions and primitives. Passing an Error returns that exact Error unchanged.

Declare a managed class before any instance is admitted. Changing its prototype or its classification afterward is unsupported.

## Managed data ownership

After host-owned managed data is passed to Cascada, application and host code must not mutate any original identity reachable from it. Cascada borrows that storage and preserves its logical value through copy-on-write; it does not make concurrent host mutation safe.

This restriction follows the original identities even if Cascada later copies them. Mutate managed data through Cascada operations or mutate a host-ready copy produced by export.

## Logical Arrays

Logical Arrays support only the controlled methods documented in [`run.md`](run.md). Custom Array methods are unsupported.

```js
class Values extends Array {
    total() { return this.reduce((sum, value) => sum + value, 0) }
}

// Unsupported through Cascada run:
run(chain, [], "total", false)
```

- A supported method name always selects Cascada's controlled implementation. An own or inherited override cannot replace it.
- Every other method name is rejected. Cascada does not inspect custom Array properties, prototypes, accessors, or proxies to find a callable.
- Array callback methods are unsupported unless explicitly listed. A supplied `sort` or `toSorted` comparator is the documented exception.
- `Symbol.isConcatSpreadable` and custom Array properties are outside the language graph and do not affect controlled `concat`.
- A host comparator must run synchronously, must not reenter Cascada, and must return a Number. An Error is its Error outcome; a Promise or any other result is invalid. It may mutate or retain its exported managed argument copies, but exact Functions and external identities remain read-only.

Use a managed class rather than an Array subclass or custom Array prototype when data needs application-defined methods.

## Managed records and classes

A managed record exposes only own enumerable Function-valued data properties as methods. Inherited Functions, accessors, non-enumerables, and extracted Functions are not record methods.

A managed class has these additional restrictions:

- Its semantic state uses only own enumerable string-keyed data properties.
- Its prototype chain up to `Object.prototype` contains data methods but no accessors.
- It does not depend on private fields, Symbols, non-enumerables, accessors, native internal slots, mutable closure or module state, parent state, or hidden shared mutable storage.
- Constructors are not run when Cascada copies an instance.
- Host code does not change its prototype chain, descriptors, or extensibility after admission.

Do not declare native internal-slot types such as `Date` managed. Their prototype can be preserved, but their hidden state cannot be reconstructed in a copy. Keep them external, and explicitly declare a nested identity external before a surrounding `managedState` walk reaches it.

These restrictions allow records and class instances to share one managed invocation model.

## Managed method contract

- The call mode must describe the method correctly. An observation does not mutate its receiver; a method that may mutate the receiver must use mutation mode.
- A method may change its exported managed argument graph in either mode. It may change its managed receiver only in mutation mode, and must not mutate unrelated exact state.
- All explicit managed arguments are exported together into one host graph independent from their Cascada sources. Aliases across argument positions remain aliases. A method may mutate, retain, store, or return that graph without changing the Cascada sources.
- Managed receiver state and exported managed arguments are separate graphs. A method must not rely on a managed argument retaining an identity relationship with `this` or one of its properties across the boundary.
- Functions and external identities remain exact when exported and are read-only as arguments. Passing or retaining one never grants external mutation authority.
- Every managed record or class method keeps mutable semantic state in `this` and receives other state through explicit arguments. It must not read or mutate mutable parent, closure, module, or other state outside those inputs.
- External identities inside a managed receiver are opaque leaves. A method may retain, replace, remove, compare, or return them, but it must not inspect or mutate their host state.
- Access nested external state through a separate Cascada operation that selects it as the external receiver. `api!.db.close()` is supported; a managed `api!.close()` must not call `this.db.close()` internally.
- A completed mutation receiver contains no Promise or Error. Managed state may contain either between calls, because Cascada resolves or propagates them before the next managed invocation.
- A method may complete synchronously or through one direct Promise. All later receiver or input access and every asynchronous effect must belong to that Promise and finish before it settles.
- Detached work, later access from a Promise nested in a synchronous result, and Cascada reentry during the invocation are forbidden.

Nested calls such as `this.increment()` are ordinary JavaScript calls on the already prepared receiver and follow the same outer invocation contract.

## External state

External identities are exact host objects. Cascada observes them by default and mutates them only through an explicitly marked external mutation.

### Mutation location

One external identity that Cascada may mutate must be used through one compiler-static location: one context Chain and one complete normalized path.

- A compiler-static path contains only compiler-known String or Number segments. A computed or Promise-valued segment is dynamic even when its value is already ready.
- The first valid mutation fixes the identity's location. Every later observation or mutation of that identity must use the same static location.
- Earlier use from another Chain, another path, outside a context Chain, or through a dynamic path permanently makes the identity ineligible for mutation.
- Import, assignment, storage, export, and return do not count as use and do not transfer the location.
- Observation-only external state may be used from several locations, but it cannot later become mutation-capable after incompatible use.
- Host code must keep the exact identity at its fixed location stable while Cascada may use it.

### Identity and hidden state

- One mutable host resource must have one external identity. Do not expose the same resource through multiple wrappers or independently scheduled roots.
- Cascada does not scan external graphs for aliases or shared descendants. Hidden mutable sharing between external roots is the developer's responsibility.
- Application code must not independently mutate or replace external state while Cascada may access it.
- External state may contain primitives, Functions, and other external identities, but no already admitted managed identity. If traversal reaches admitted managed data inside an external property graph, the external container is poisoned.
- An identity read from an external property remains external even when it is a record or Array. A host method result crosses a separate import boundary and may therefore be admitted as managed data.
- Managed state may contain external identities, subject to the opaque-leaf managed-method rule above.

### External operations

- An external observation must not mutate its receiver.
- An external mutation may mutate state encapsulated by its selected exact receiver, including deeply reached host state. It must not mutate another external root or an exact external argument.
- A property read crosses into Cascada and its result is imported. A property write crosses into host code and its value is exported first.
- A native setter must finish synchronously.
- External mutation authority is never transferred through lookup, assignment, an argument, export, storage, or return.

### Repair

External mutation failure poisons its selected ordering scope rather than replacing the external value. An invalid mutation with no authorized context scope returns an Error but creates no repairable path state. Cascada's `!!` syntax lowers to one of two runtime operations:

- `apis.db!!` issues an exclusive repair-only operation. It clears poison for the selected external scope, performs no host access, has logical result `undefined`, and is harmless when the scope is already clear.
- `apis.db!!.close()` issues one exclusive repair-and-mutate operation. It bypasses old poison and calls `close()`; success leaves the scope clear, while failure stores the new Error as poison.

Repair requires a compiler-static context path. It records use but does not establish mutation authority. Repair does not remove Errors stored in application data, clear ancestor or unrelated poison, change external-use history, or restore mutation eligibility. There is no combined repair-and-observe operation; issue repair-only and then an ordinary observation.

A ready repair produces `undefined` directly; one waiting for earlier external work produces a Promise for `undefined`. The following Cascada operation can still be issued immediately and is ordered after the repair.

## Boundary values and host code

Host data entering Cascada's language graph is imported. Data leaving the graph for host JavaScript is exported. A synchronous scalar callback result used only to control its operation is validated by that callback's contract instead of entering the graph.

- Import is used for host roots, supported host-call and callback results that enter the graph, external-property reads, and later Promise fulfillment from those boundaries.
- Export is used for native-call arguments, controlled callback inputs, external-property writes, and script results.
- Exported managed records, Arrays, and class instances are independent host data. Class copies preserve their admitted prototypes without running constructors. Host code may mutate or retain the copies without changing their Cascada sources.
- Functions and external identities cross exactly. Host code must treat them as read-only unless the exact external identity is the separately authorized mutation receiver.
- Export consumes Errors at any depth. If any argument or assigned value contains an Error, host code is not called and no Error crosses the boundary.
- Host code may retain exported copies. It must not retain access to an unexported managed receiver or source.
- Host methods, accessors, callbacks, and reflection hooks must not issue Cascada operations while active.
- A direct result Promise may keep using its receiver and exported inputs until it settles. A nested result Promise does not extend that permission.
- A callback invoked by a controlled method must complete synchronously and must not return a Promise. It receives only its declared exported inputs and may not access an unexported managed source.

## Choosing a representation

- Use a record for ordinary managed data without inherited behavior.
- Use a managed class when state needs application-defined methods or when large records would be copied frequently.
- Use a logical Array only for indexed data and supported controlled methods.
- Use external state for live host resources, native objects, APIs, databases, streams, handles, and state that Cascada cannot fully own.
- Keep immutable values external when they need native identity or unsupported internal state, such as a `Date` used only as a value.
