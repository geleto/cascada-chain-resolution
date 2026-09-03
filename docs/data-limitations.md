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
- A Promise input that an operation does not consume remains host-owned. This includes an unused path segment or an argument to a call rejected while its receiver is ready; application code remains responsible for handling its rejection. While receiver selection is pending, explicit call arguments are provisionally consumed only at root availability so their captured values can be preserved if the boundary uses them.
- A language Error has no operations and propagates when consumed.

## Errors

`PoisonError` is recoverable language data. It records an opaque source context,
a stable failure kind, and, for a native host Error, that Error in `.cause`.
Once contextualized, the occurrence propagates unchanged; a later consumer does
not replace its source. Reusing one native Error at another causal boundary
creates another wrapper for that occurrence.

`CompoundPoisonError` contains flattened leaves in `.errors`, preserves their
logical order and individual attribution, and keeps one leaf per
`leaf.cause ?? leaf`. `RuntimeError` represents a fatal runtime or host-contract
failure. It is reported and rethrown, never treated as language data.

Imported host storage keeps nested native Error objects unchanged while Cascada
exposes their contextual wrappers as the logical property values. Declaration
APIs are outside the graph and therefore return a supplied Error unchanged. No
language Error is exported to host code.

## Classification and declarations

Records and Arrays default to managed. Class instances default to external.

- Call `externalState(value)` before passing the value to Cascada to make one exact record, Array, or class instance external. The declaration is shallow and overrides `managedStateClass` for that identity.
- Call `managedState(value)` before passing the value to Cascada to make a class instance managed. When given undeclared managed data, it also declares reachable class instances until it reaches declared external or uninspectable boundaries.
- Call `managedStateClass(...classes)` to make subsequently admitted instances of those exact classes managed. The rule is not inherited by subclasses.
- Classification becomes permanent at first admission within one execution. Later declarations and class-registry changes cannot reclassify that execution's identity, but another execution admits the same host identity independently.
- Repeating the same declaration is allowed. A conflicting declaration returns a validation Error without changing the established category.
- Declaration APIs are synchronous and never await. Do not pass them a Promise or callable thenable. `externalState` also rejects Functions and primitives. Passing an Error returns that exact Error unchanged.

Declare a managed class before ordinary admission of its instances. A detached property copy from mutable external state may instead preserve a source prototype after validating it against the managed-class contract; this does not make other instances managed. Changing an admitted identity's prototype or classification afterward is unsupported.

## Managed data ownership

After host-owned managed data is passed to Cascada, application and host code must not mutate any original identity reachable from it. Cascada borrows that storage and preserves its logical value through copy-on-write; it does not make concurrent host mutation safe.

This restriction follows the original identities even if Cascada later copies them. Mutate managed data through Cascada operations or mutate a host-ready copy produced by export.

Managed values move between independent Cascada executions only through export followed by import. Do not pass an execution's internal managed identity directly into another execution. Host code can independently supply the same exact external identity to several executions, but Cascada cannot coordinate those executions. Share it only when it is observation-only; a mutation-capable external identity must belong to one execution.

## Runtime primordials

Cascada assumes the global `Array`, `Array[Symbol.species]`, the standard Array intrinsics, `Array.prototype`, `String.prototype`, and `Object.prototype` are not modified. Otherwise native dispatch, inherited indexes, accessors, species, or protocols could change controlled behavior.

Custom or replaced methods and accessors on `String.prototype` or `Object.prototype` are unsupported through native String dispatch. Cascada never invokes those accessors while selecting a String method.

A boxed String's own character indexes and `length` are not method candidates. `Object.prototype.__proto__` is an accessor, so it is unsupported and never invoked.

## Logical Arrays

Logical Arrays support only the controlled methods documented in [`run.md`](run.md). Custom Array methods are unsupported.

```js
class Values extends Array {
    total() { return this.reduce((sum, value) => sum + value, 0) }
}

// Unsupported through Cascada run:
run(chain, [], "total", [], operationContext, {})
```

- A supported method name always selects Cascada's controlled implementation. An own or inherited override cannot replace it.
- Every other method name is rejected. Cascada does not inspect custom Array properties, prototypes, accessors, or proxies to find a callable.
- Controlled numeric and string arguments use Cascada's logical conversion, not native coercion of exported objects. External identities such as `Date` are invalid in these scalar positions; Cascada never invokes their `valueOf`, `toString`, or `Symbol.toPrimitive` hooks.
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
- External identities inside a managed receiver are opaque leaves. A method may retain, compare, return, or add another reference to them, but it must not inspect or mutate their host state. It may replace or remove an observation-only identity, but must not move, replace, or remove a mutation-capable identity recorded at a live context-tree leaf.
- Access nested external state through a separate Cascada operation that selects it as the external receiver. `api!.db.close()` is supported; a managed `api!.close()` must not call `this.db.close()` internally.
- A completed mutation receiver contains no Promise or Error. Managed state may contain either between calls, because Cascada resolves or propagates them before the next managed invocation.
- A managed method may complete synchronously or through one direct Promise. Later receiver access and any inspection of a read-only exact external input must belong to that Promise and finish before it settles.
- Detached receiver or external-input work and Cascada reentry during the invocation are forbidden. A Promise nested in a synchronous result must not later access or expose the receiver, or inspect or mutate an exact external input; return that Promise directly when its completion needs such access. Exact external identities may be retained or returned inertly because this grants no authority. The managed structure of exported argument copies may be retained, used, or returned later; exact external leaves inside it follow the same rule.

Nested calls such as `this.increment()` are ordinary JavaScript calls on the already prepared receiver and follow the same outer invocation contract.

## External state

External identities are exact host objects. Cascada observes them by default and mutates them only through an explicitly marked external mutation.

### Mutation location

One external identity that Cascada may mutate must be available under a compiler-provided mutation path during initial context import and used through one location: one context Chain and one complete normalized path.

- Mutation paths are String/Number prefixes selected by `!` and String/Number complete targets of assignment and deletion. Initial import searches only the supplied paths and their selected subtrees.
- Initial import records only external boundaries reached without crossing a Promise. Mutation paths containing no external boundary are discarded. External identities outside the resulting tree, Promise-revealed identities, and subsequently added identities remain observation-only.
- The first actual observation or mutation must occur at a recorded location and selects that one location. Every later use of that identity must use the same Chain and path.
- First use elsewhere, or later use through another Chain or path, later alias, copied occurrence, or Promise-revealed occurrence elsewhere, creates permanent conflict. The operation performs no host access, poisons the external identity's ordering state, and returns an Error explaining the first incompatible use even when it requested observation.
- Several stored occurrences do not conflict until used. If one identity appears at several recorded leaves, the first actual use selects one; use through another conflicts.
- Managed assignment creates another owner rather than JavaScript reference semantics. Later mutation through either managed placement uses COW and cannot change the original live binding.
- A Cascada replacement, deletion, or Array remap that would remove, replace, hide, or relocate a live leaf fails before publication. Array changes that leave every live leaf at the same index and path remain valid. Managed host methods must preserve every live leaf at its recorded path and identity; a detected violation is fatal.
- Another reference may be stored elsewhere, including at another Array index, but actual external use through it creates permanent conflict.
- A later Cascada gate may temporarily hide the original path without changing it.
- Passing an exact external identity as a host argument, external write value, or controlled-callback input is use at its captured source location. Source provenance belongs to the captured value; Cascada never substitutes a later value from that path.
- Import, managed-graph assignment, storage, export copying, and return do not count as use or transfer authority. Actual use of a stored alias still conflicts when reached.
- An identity reached only after waiting acquires no late phase. If it was not already selected from the static external mutation tree, it returns an Error before host access when it conflicts with a mutation-capable identity.
- External identities never recorded in an external mutation tree are observation-only and may be observed from any location. Their aliases are the developer's responsibility because Cascada provides no mutation ordering for them.
- Public `import(value, operationContext)` creates no external mutation tree or mutation authority. `operationContext` carries the execution and source-error information. External identities entering through import remain observation-only even if its result later becomes an ordinary Chain root in that execution. Mutation-capable context state must enter through `ContextChain` initialization.

A `!` prefix declares the complete mutation scope. An external host operation may affect only the live external-mutation-tree leaves selected beneath that prefix. A conflicted leaf is removed lazily when queried and no longer disables broad operations on its siblings; host code must not mutate that removed identity. A managed method receives no authority over external descendants.

A `!` attached to a method call selects that method's receiver. Moving it to an earlier receiver prefix broadens the scope; the method Function itself is not graph state or a separate ordering scope.

An external identity is opaque. A `!` written deeper inside it still selects that first external boundary: if `apis` is external, `apis!.db.write()` and `apis.db!.write()` share the `apis` ordering scope. Put independently ordered external identities such as `db` and `cache` in a managed parent when they need separate scopes.

### Identity and hidden state

- One mutable host resource must have one external identity. Do not expose the same resource through multiple wrappers or independently scheduled roots.
- Cascada does not scan external graphs for aliases or shared descendants. Hidden mutable sharing between external roots is the developer's responsibility.
- Application code must not independently mutate or replace external state while Cascada may access it.
- Mutation-capable external APIs should be stable context resources, such as databases, web services, or LLM clients. Do not move, replace, or delete their original context binding after initialization.
- External state may contain primitives, Functions, and other external identities, but no already admitted managed identity. If traversal reaches admitted managed data inside an external property graph, the external container is poisoned.
- An identity read from observation-only external property state remains external even when it is a record or Array. Reading inside mutable external state instead produces a detached managed copy that preserves prototypes and Functions. Any copied class-like value must satisfy the managed-class state and method restrictions; native/internal-slot objects that cannot survive structural copying must be returned through a host method or remain observation-only external state.
- Managed state may contain external identities, subject to the opaque-leaf managed-method rule above.

### External operations

- An external observation must not mutate its receiver.
- An external mutation may mutate state encapsulated by its selected exact receiver and live external siblings selected by an ancestor `!` scope. Every external argument must validate its source location. An argument grants no authority; only independent selection by the mutation scope makes the same identity mutable. All other exact external arguments and external state outside the scope remain read-only.
- A property read crosses into Cascada through import. Observation-only external state retains its external result; mutable external state uses import's detached-copy policy instead. A property write crosses into host code and its value is exported first.
- The detached copy uses export's synchronous graph-copy semantics: it preserves Arrays, aliases, cycles, prototypes, and Functions and may therefore expose supported managed methods without exposing the mutable external source. A Promise returned directly by the selected property may resolve before copying, but the copied graph itself must contain no Promise.
- Assignment and deletion are mutations even without `!`; their default mutation scope is the exact target placement. An explicit ancestor `!` broadens that scope, while a target inside external state clamps to its first external boundary.
- Replacing `ctx.db` changes a managed placement even when its old value is external. Changing `ctx.db.name` is an external property operation when `ctx.db` is external.
- A native setter must finish synchronously.
- External mutation authority is never transferred through lookup, assignment, an argument, export, storage, or return.

### Repair

External mutation failure poisons its selected ordering scope rather than replacing the external value. An invalid mutation with no authorized context scope returns an Error but creates no repairable path state. Cascada's `!!` syntax lowers to one of two runtime operations:

- `apis.db!!` issues an exclusive repair-only operation. It clears poison for the selected external scope, performs no host access, has logical result `undefined`, and is harmless when the scope is already clear.
- `apis.db!!.close()` issues one exclusive repair-and-call operation. It bypasses old poison and calls `close()`; success leaves the scope clear, while failure stores the new Error as poison.

Repair requires the identity's selected context location. Another occurrence cannot repair it. Repair does not record use, establish authority, clear permanent location conflict, or remove Errors stored in application data. There is no repair-and-observe, repair-and-assign, or repair-and-delete operation.

Ordinary assignment replaces, and deletion removes, an Error at their final managed placement. This needs no repair marker. An Error in an earlier path segment still propagates. External phase poison is not a property value, so an external property write or deletion remains blocked until repair-only clears that poison.

A repair marker inside opaque external state selects the first external boundary, just like mutation. If `apis` is external, `apis.db!!` repairs the `apis` ordering scope.

A ready repair produces `undefined` directly; one waiting for earlier external work produces a Promise for `undefined`. The following Cascada operation can still be issued immediately and is ordered after the repair.

## Boundary values and host code

Host data entering Cascada's language graph is imported. Data leaving the graph for host JavaScript is exported. A synchronous scalar callback result used only to control its operation is validated by that callback's contract instead of entering the graph.

- Import is used for host roots, supported host-call and callback results that enter the graph, external-property reads, and later Promise fulfillment from those boundaries.
- Export is used for native-call arguments, controlled callback inputs, external-property writes, and script results.
- Export, `hasError`, and `getErrors` treat an external identity as a terminal graph value. Their paths do not inspect external properties or external guard poison. Read an external property through an ordinary Cascada lookup before exporting or querying the imported result.
- Exported managed records, Arrays, and class instances are independent host data. Class copies preserve their admitted prototypes without running constructors. Host code may mutate or retain the copies without changing their Cascada sources.
- Functions and external identities cross exactly. Host code must treat them as read-only unless the exact external identity is independently covered by the active receiver mutation scope.
- Export consumes Errors at any depth. If any argument or assigned value contains an Error, host code is not called and no Error crosses the boundary.
- Host code may retain exported copies. It must not retain access to an unexported managed receiver or source.
- Host methods, accessors, callbacks, and reflection hooks must not issue Cascada operations while active.
- A direct result Promise may keep using its receiver and exact external inputs until it settles. A nested result Promise does not extend that authority, though it may carry an exact external identity as inert result data. The managed structure of exported copies may outlive either Promise; exact external leaves gain no later authority.
- A callback invoked by a controlled method must complete synchronously and must not return a Promise. It receives only its declared exported inputs and may not access an unexported managed source.

## Choosing a representation

- Use a record for ordinary managed data without inherited behavior.
- Use a managed class when state needs application-defined methods or when large records would be copied frequently.
- Use a logical Array only for indexed data and supported controlled methods.
- Use external state for live host resources, native objects, APIs, databases, streams, handles, and state that Cascada cannot fully own.
- Keep immutable values external when they need native identity or unsupported internal state, such as a `Date` used only as a value.
