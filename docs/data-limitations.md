# Data and Host-Code Limitations

This is the authoritative developer-facing contract for data passed between JavaScript and Cascada. The runtime may reject unsupported data, but restrictions on native code are trusted contracts unless stated otherwise.

## Terms

- **Managed data:** data whose complete logical state Cascada can traverse, resolve, copy, and isolate. Records and Arrays are managed by default; declared class instances can also be managed.
- **External state:** an exact host identity whose live state Cascada does not copy or manage. Class instances are external by default; a record or Array can be declared external.
- **Host code:** JavaScript methods, accessors, callbacks, and other functions invoked across the Cascada boundary.
- **Controlled method:** a runtime implementation, such as a supported logical Array method, that operates directly on logical Cascada data rather than arbitrary host state.
- **Supported thenable:** a native Promise with standard behavior or an ordered, chainable Promise-like value satisfying the contract below.

## Allowed nondeterminism in Error handling

Successful supported operations retain sequential equivalence, ownership, immutable-output, and FIFO effect-ordering guarantees. The exceptions below concern Error reporting and detection; they grant no permission to reorder successful data operations or omit required Error collection. Do not add a global ordering barrier, sorting pass, or history registry solely to make these failure outcomes deterministic.

| Case | What may vary | What remains required |
| --- | --- | --- |
| Compound Errors and `getErrors` | Child order, the retained representative among equivalent wrappers, and the compound's representative source | Complete semantic membership for required collection; every retained child keeps its cause, source, and kind; created Errors and child arrays never change afterward |
| Competing independent fatal failures | Which failure reaches the execution's first fatal commit | One authoritative Error per execution, reporting once, prompt failure of pending operation results, and no later runtime effects after the normal fatal checkpoints |
| An operation result racing execution fatality | Whether outward settlement finishes before an independently detected fatal | The existing first-transition rule: a pending outward result fails on fatality; an already-settled result cannot be changed |
| Invalid sharing of one mutable external identity between independent context imports | When the conflict is discovered, which location reports it first, and which earlier operations have already completed | No permanent winner chosen by import arrival order; once the competing bindings are known, access through both fails; completed results and host effects cannot be undone |

The external case violates the single-context-location input contract. It does not authorize mutable sharing in a successful program or promise that both import calls can be rejected before either context is used. Independent imports have no guaranteed invocation order. A regular Chain creates no competing mutation binding; invalid access through it must not invalidate the context binding. An inert regular-Chain occurrence imported earlier does not disqualify the context. Earlier off-path access or exposure before any mutation binding is known cannot be retroactively rejected or repaired by rewriting a retained placement; such use of an identity intended for contextual mutation is already outside the single-location contract. The agreed reverse-import-order and lazy-access policy is specified in [external-context-ordering.md](external-context-ordering.md#context-and-regular-chain-import-order).

A short-circuit query does not collect failures from branches it no longer needs. In particular, `hasError` may finish with `true` before another branch can cause query reflection failure, or that failure may terminate the query first. This exception concerns competing Error-query outcomes; it does not permit availability-dependent answers for a clean graph. Fatality still follows the execution rule above.

Applications must not use compound child order, its representative source, or the winner among independent fatal detections as a control-order guarantee. Future diagnostic sorting may arrange a separate view without changing the stored Error or execution scheduling.

## Graph-visible data

Cascada graph state consists only of own enumerable string-keyed data properties.

- Records expose those properties.
- Arrays expose canonical indexes. Length and holes retain Array semantics, but custom properties are outside the graph.
- Symbols, inherited properties, non-enumerables, accessors, prototypes, private fields, and native internal slots are outside the graph.
- An accessor or non-enumerable property is treated as absent. Cascada does not invoke it as managed graph data.
- Paths use String or Number segments. Other resolved segment values are invalid and are never coerced through user hooks.
- Aliases, cycles, sparse Arrays, Functions, Errors, external identities, and nested Promises are supported unless a narrower rule below excludes them.
- A successful non-Promise language-data result must not expose a callable `then` through native property lookup. Cascada rejects a callable own `then` placement during assignment, Promise-backed publication, or managed receiver validation. Managed-class declaration and snapshot adoption reject a callable `then` anywhere on the retained prototype chain; that chain must remain unchanged afterward. Records and Arrays rely on stable standard prototypes, while exact Functions and external identities must remain read-only after admission. A non-callable `then` remains ordinary data. Without these source restrictions, native Promise resolution would invoke the object only when an operation happened to complete asynchronously, so ready and pending forms could not be equivalent.

Do not place semantic managed state outside graph-visible properties. Cascada may copy or materialize managed data without copying hidden state or preserving traversable identity between operations.

## Executable positions

- A Function is data unless a supported method or callback position explicitly selects it for execution.
- `constructor` is never a callable method through `run`.
- Strings support documented native observations only.
- Number, Boolean, BigInt, Symbol, `null`, and `undefined` have no methods or property writes.
- A Promise or supported thenable has no direct operations; the resolved value determines its capabilities.
- A Promise or supported-thenable input that an operation does not consume remains host-owned. This includes an unused path segment or an argument to a call rejected while its receiver is ready; application code remains responsible for handling its rejection. While receiver selection is pending, explicit call arguments are provisionally consumed only at root availability so their captured values can be preserved if the boundary uses them.
- A language Error has no operations and propagates when consumed.

## Promises and supported thenables

Cascada supports native Promises with standard behavior and custom ordered,
chainable thenables. Error and Function classification takes precedence over
thenability. In this contract and the architecture that depends on it,
unqualified **Promise** in a semantic role such as an input, direct result,
placement, mirror, or frontier includes any supported thenable; **native
Promise** means the built-in JavaScript mechanism specifically. A supported
custom thenable:

- exposes a callable `then` whose identity and behavior remain stable while Cascada may use it;
- represents one outcome, supports every subscription Cascada makes, invokes at most one supplied callback once per subscription, and gives every subscription that same outcome;
- delivers callbacks in subscription order, including across settlement: a later
  subscription to an already-settled value cannot overtake an earlier
  subscription whose callback has not yet been delivered;
- may invoke a callback synchronously when its outcome is already available; and
- returns the callback result directly when it invokes the callback synchronously, or a supported thenable representing that callback's eventual result when delivery is pending.

If a synchronously invoked callback throws, that throw escapes the `then` call
synchronously. If callback delivery is pending, a later callback throw rejects
the chain returned by `then`. An implementation that cannot provide this
sync-first chain contract should expose a native Promise instead.

A custom thenable delivers a final non-thenable fulfillment value; it owns any
nested assimilation before invoking the fulfillment callback. Native Promises
retain native assimilation. This contract admits Cascada's sync-first resolved
values and rejecting Errors without imposing a microtask on ready work.

Cascada invokes `then` through its common continuation helper at the operation's
program position. The thenable itself owns subscription storage, settlement,
and FIFO delivery. Cascada does not cache `then`, canonicalize the thenable onto
another Promise, maintain a parallel subscriber queue, or inspect the object
returned by `then` as shared settlement state. A synchronous callback is
processed in the same turn; Cascada adds no microtask merely to normalize it.
The `then` invocation is a trusted scheduling protocol, not a general host-code
callback: its implementation performs its own subscription, delivery, and
chaining work, and must not call back into Cascada synchronously except through
the supplied callbacks. Cascada does not add state merely to diagnose violations
of that contract.

After consuming a possible thenable, Cascada derives readiness only from the
returned transition result. A transition that finishes synchronously returns
its direct result; one whose required work remains unfinished returns its
pending chain. Cascada does not infer readiness from whether a callback ran or
whether that callback wrote into a mirror, aggregate slot, receiver, or other
state. Such writes may carry the transition's data, but they are not readiness
signals. A transition that starts another possible thenable consumes it through
the same rule before returning, so any thenable left in this trusted result
position is actually pending. Error, Function, and fixed admitted-category
precedence still applies to that check.

Readiness is relative to the work being completed. A pending independent result
does not mean that path selection, receiver mutation, or source access remains
unfinished. Once those transitions finish, their protection ends according to
their own contracts even when the independent result is still pending. A
subscription may invoke its continuation before returning; only a callback
still pending after that return is excluded by JavaScript run-to-completion
from interleaving before the current stack returns.

Dynamic or throwing `then` getters, Proxy-dependent `then` behavior, changing
methods, inconsistent outcomes, repeated settlement, insufficient subscription
support, non-FIFO delivery, and custom fulfillment with another thenable are
outside the supported data contract. Cascada does not add validation or repair
machinery for these cases. A failure that ordinary supported-host boundary
handling observes is still classified normally; undetectable ordering violations
remain host-contract violations.

## Errors

`PoisonError` is recoverable language data. It records an opaque source context, a stable failure kind, and the exact raw cause. Once contextualized, it propagates by reference without changing its source. Separate introductions may construct distinct immutable wrappers. Collection treats wrappers as equivalent when their raw cause, source-context identity, and kind match; physical wrapper identity is not a cross-construction guarantee.

`CompoundPoisonError` contains flattened leaves in `.errors` and preserves each retained leaf's attribution. It and `getErrors` use the same semantic deduplication rule above, with unspecified order and no persistent Error cache. Different source contexts or kinds remain distinct even when the cause is the same.

`FatalError` represents an execution-ending internal defect, broken invariant, or unsafe
host failure. It is reported and rethrown, never treated as language data.
Kernel-created Error wrappers and compound child arrays are frozen after
construction, so exposing an Error cannot mutate later graph attribution.

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
- Declaration APIs are synchronous and never await. Do not pass them a Promise or supported thenable. A declaration performs ordinary thenability recognition as it reaches each identity; failure to inspect an unsupported identity returns a validation Error and records nothing. It creates no Promise, thenability cache, or persistent continuation state. `externalState` also rejects Functions and primitives. Passing an Error returns that exact Error unchanged without reading `then`.

Declare a managed class before ordinary admission of its instances. A detached property copy from mutable external state may instead preserve a source prototype after validating it against the managed-class contract; this does not make other instances managed. Changing an admitted identity's prototype or classification afterward is unsupported.

## Managed data ownership

After host-owned managed data is passed to Cascada, application and host code must not mutate any original identity reachable from it. Cascada borrows that storage and preserves its logical value through copy-on-write; it does not make concurrent host mutation safe.

This restriction follows the original identities even if Cascada later copies them. Mutate managed data through Cascada operations or mutate a host-ready copy produced by export.

Managed values move between independent Cascada executions only through export followed by import. Do not pass an execution's internal managed identity directly into another execution. Host code can independently supply the same exact external identity to several executions, but Cascada cannot coordinate those executions. Share it only when it is observation-only; a mutation-capable external identity must belong to one execution.

## Runtime primordials

Cascada assumes the global `Array`, `Array[Symbol.species]`, the standard Array intrinsics, `Array.prototype`, `Promise`, `Promise.prototype`, `String.prototype`, and `Object.prototype` are not modified. Otherwise native dispatch, inherited indexes, accessors, species, or protocols could change controlled behavior.

Runtime-owned `FatalError` objects nevertheless define their own non-callable `then`. This narrowly prevents `Error.prototype.then` from changing fatal Error behavior under native Promise assimilation; it is not general support for modified `Error.prototype` or other primordials.

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
- A host comparator must run synchronously and return a Number. An Error is its Error outcome; a Promise or any other result is invalid. It may mutate or retain its exported managed argument copies, but exact Functions and external identities remain read-only. It must not synchronously re-enter Cascada.

Use a managed class rather than an Array subclass or custom Array prototype when data needs application-defined methods.

## Managed records and classes

A managed record exposes only own enumerable Function-valued data properties as methods. Inherited Functions, accessors, non-enumerables, and extracted Functions are not record methods.

A managed class has these additional restrictions:

- Its semantic state uses only own enumerable string-keyed data properties.
- Its prototype chain up to `Object.prototype` contains data methods but no accessors or callable `then`.
- It does not depend on private fields, Symbols, non-enumerables, accessors, native internal slots, mutable closure or module state, parent state, or hidden shared mutable storage.
- Constructors are not run when Cascada copies an instance.
- Host code does not change its prototype chain, descriptors, or extensibility after admission.

Changing a prototype after admission violates the host contract, but violation is not itself proof that the runtime is corrupt. If method selection detects an accessor, callable `then`, or another invalid prototype shape before invoking host code or publishing receiver state, the call returns `InvalidManagedReceiver` and preserves the original receiver. It becomes fatal only when the change has already made runtime state, ownership, ordering, or publication untrustworthy.

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
- A completed mutation receiver contains no Promise, supported thenable, or Error. Validation rejects a stored thenable without consuming it, even if it could deliver synchronously. Managed state may contain these values between calls, because Cascada resolves or propagates them before the next managed invocation.
- A managed method may complete synchronously or through one direct Promise. Later receiver access and any inspection of a read-only exact external input must belong to that Promise and finish before it settles.
- A direct Error always reports method failure, whether returned, fulfilled, thrown, or rejected. A mutating call applies its receiver-failure behavior; returning an Error as successful payload is unsupported. If ordinary failure publication would remove a live external mutation-tree leaf, Cascada preserves the original managed receiver and returns the Error instead.
- Detached receiver or external-input work is forbidden. A Promise nested in a synchronous result must not later access or expose the receiver, or inspect or mutate an exact external input; return that Promise directly when its completion needs such access. Exact observation-only external identities may be retained or returned inertly because this grants no authority. The managed structure of exported argument copies may be retained, used, or returned later; exact external leaves inside it follow the same rule. Synchronous Cascada re-entry is forbidden; independent work started after the host call returns uses its own explicit operation context.

Nested calls such as `this.increment()` are ordinary JavaScript calls on the already prepared receiver and follow the same outer invocation contract.

## External state

External identities are exact host objects. Cascada observes them by default and mutates them only through an explicitly marked external mutation.

### Mutation location

One external identity that Cascada may mutate must be available under a compiler-provided mutation path during initial context import and used through one location: one context Chain and one complete normalized path.

- Mutation paths are String/Number prefixes selected by `!` and String/Number complete targets of assignment and deletion. If such a path contains a dynamic segment, the compiler supplies its longest preceding String/Number prefix for conservative subtree discovery. Initial import searches only the supplied paths and their selected subtrees.
- Initial import records external boundaries reached during its initial synchronous segment, including through synchronously consumed custom thenables. Discovery stops at actually pending Promise-backed values. Mutation paths containing no external boundary are discarded. External identities outside the resulting tree, identities revealed only by later delivery, and subsequently added identities remain observation-only.
- Every supported call or property operation on a mutation-capable external identity must use its registered context Chain and one fixed normalized path. A regular Chain retaining the identity acquires no external mutation authority.
- Access through a regular Chain or another unregistered location fails locally before host access, even for an observation; it does not poison the valid context binding or its external phase. Competing independent context registrations instead invalidate the shared authority once the conflict is known, without choosing a permanent winner by arrival order.
- Initial context import rejects one exact external identity discovered at two distinct normalized boundary paths with `ExternalLocationConflict`, including candidates found through conservative dynamic scopes. The complete initial segment fails before registration, leaving existing bindings unchanged. Repeated discovery of the same normalized location merges. Several inert stored occurrences outside the selected discovery do not themselves claim authority; future off-path use still fails locally. See [duplicate candidate paths](external-context-ordering.md#duplicate-candidate-paths-within-one-context).
- Managed assignment creates another owner rather than JavaScript reference semantics. Later mutation through either managed placement uses COW and cannot change the original live binding.
- A Cascada replacement, deletion, or Array remap that would remove, replace, hide, or relocate a live leaf fails before publication. Array changes that leave every live leaf at the same index and path remain valid. Managed host methods must preserve every live leaf at its recorded path and identity. A detected violation returns `InvalidManagedReceiver`, discards the private receiver, and preserves the original managed state; it is fatal only if host code has already changed external state without authority or made runtime state untrustworthy.
- Another reference may be stored elsewhere, including at another Array index, but off-path external use through it fails locally and grants no authority.
- A later Cascada gate may temporarily hide the original path without changing it.
- A mutation-capable external identity cannot be passed as a host argument, external write value, or controlled-callback input. Export returns an Error before host code runs and records no use. Observation-only external identities may cross unchanged and remain read-only.
- Import, managed-graph assignment, storage, export copying, and return do not count as use or transfer authority. Actual use of a stored alias still conflicts when reached.
- An identity reached only after waiting acquires no late phase. If it was not already selected from the static external mutation tree, it returns an Error before host access when it conflicts with a mutation-capable identity.
- External identities never recorded in an external mutation tree are observation-only and may be observed from any location. Their aliases are the developer's responsibility because Cascada provides no mutation ordering for them.
- Public `import(value, operationContext)` creates no external mutation tree or mutation authority. `operationContext` carries the execution and source-error information. External identities entering through import remain observation-only even if its result later becomes an ordinary Chain root in that execution. Mutation-capable context state must enter through `ContextChain` initialization.

A `!` prefix declares the complete mutation scope. An external host operation may affect only the live external-mutation-tree leaves selected beneath that prefix. A conflicted leaf remains an inert discovery fact and is excluded from live authority queries without disabling broad operations on its siblings; host code must not mutate that excluded identity. A managed method receives no authority over external descendants.

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
- A property read crosses into Cascada through ordinary import when the external state is observation-only. A read inside mutable external state instead returns a detached managed snapshot. A property write crosses into host code and its value is exported first.
- The detached copy has the same visible graph-copy semantics as export: it preserves Arrays, aliases, cycles, prototypes, and Functions and may therefore expose supported managed methods without exposing the mutable external source. A Promise returned directly by the selected property may resolve before copying, but the copied graph itself must contain no Promise.
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

A repair whose predecessor and repair transitions complete synchronously produces `undefined` directly. Otherwise it produces a Promise for `undefined`; a native predecessor subscription defers delivery even after that predecessor has settled. The following Cascada operation can still be issued immediately and is ordered after the repair.

## Boundary values and host code

Host data entering Cascada's language graph is imported. Data leaving the graph for host JavaScript is exported. A synchronous scalar callback result used only to control its operation is validated by that callback's contract instead of entering the graph.

- Import is used for host roots, supported host-call and callback results that enter the graph, external-property reads, and later Promise fulfillment from those boundaries.
- Export is used for native-call arguments, controlled callback inputs, external-property writes, and script results.
- Export, `hasError`, and `getErrors` treat an external identity as a terminal graph value. Their paths do not inspect external properties or external poison. Read an external property through an ordinary Cascada lookup before exporting or querying the imported result.
- Exported managed records, Arrays, and class instances are independent host data. Class copies preserve their admitted prototypes without running constructors. Host code may mutate or retain the copies without changing their Cascada sources.
- Functions and external identities cross exactly. Host code must treat them as read-only unless the exact external identity is independently covered by the active receiver mutation scope.
- Export consumes Errors at any depth. If any argument or assigned value contains an Error, host code is not called and no Error crosses the boundary.
- Host code may retain exported copies. It must not retain access to an unexported managed receiver or source.
- Host methods, accessors, controlled callbacks, and reflection hooks must not synchronously re-enter Cascada. Attempted re-entry is fatal because the outer transition has not yet published an ordering point; higher-runtime nested script dispatch must occur outside an active host boundary. Trusted runtime control-flow callbacks such as `enter` follow their explicit gate/lease and closure contracts instead.
- A direct result Promise may keep using its receiver and exact external inputs until it settles. A nested result Promise does not extend that authority, though it may carry an exact external identity as inert result data. The managed structure of exported copies may outlive either Promise; exact external leaves gain no later authority.
- A direct host Promise must not depend on a nested Cascada operation ordered behind that call's active managed gate or external phase. Such a dependency is a self-wait and is invalid host behavior.
- A callback invoked by a controlled method must complete synchronously and must not return a Promise. It receives only its declared exported inputs and may not access an unexported managed source.

## Choosing a representation

- Use a record for ordinary managed data without inherited behavior.
- Use a managed class when state needs application-defined methods or when large records would be copied frequently.
- Use a logical Array only for indexed data and supported controlled methods.
- Use external state for live host resources, native objects, APIs, databases, streams, handles, and state that Cascada cannot fully own.
- Keep immutable values external when they need native identity or unsupported internal state, such as a `Date` used only as a value.
