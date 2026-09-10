# Data and Host-Code Limitations

This is the authoritative developer-facing contract for data passed between JavaScript and Cascada. The runtime may reject unsupported data, but restrictions on native code are trusted contracts unless stated otherwise.

## Terms

- **Managed data:** data whose complete logical state Cascada can traverse, resolve, copy, and isolate. Records and Arrays are managed by default; declared class instances can also be managed.
- **External state:** an exact host identity whose live state Cascada does not copy or manage. Class instances are external by default; a record or Array can be declared external.
- **External code:** JavaScript methods, accessors, callbacks, and other functions invoked across the Cascada boundary.
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
- A successful non-Promise language-data result must be safe under native Promise resolution. Cascada rejects an ordinary callable own `then` placement during assignment and Promise-backed publication. Completed managed mutation validates the native lookup surface on the receiver and every traversable managed descendant, including non-enumerable own properties, Array non-index properties, and inherited descriptors: callable data properties and accessors yield `InvalidManagedReceiver`, without invoking accessors. This does not add those properties to the language graph. Managed-class declaration and snapshot adoption also reject callable or accessor `then` anywhere on the retained prototype chain; that chain must remain unchanged afterward. Records and Arrays rely on stable standard prototypes.
- An exact Function or external identity used as a successful non-Promise language value must have a stable native `then` lookup that safely yields a non-callable value throughout its use, including before admission. Remaining read-only after admission does not establish that initial condition. Function and Error classification still precede availability recognition: classifying a Function without sampling its `then` does not promise supported output for an unsafe Function. Errors retain their separate Error semantics. Unsafe exact values are outside the host contract; Cascada adds no recurring reflection probe, thenability cache, or facade wrapper to support them. A non-callable data `then` remains ordinary. Without these source restrictions, native Promise resolution could invoke the same object only when an operation completed asynchronously, breaking ready/pending equivalence.

Do not place semantic managed state outside graph-visible properties. Cascada may copy or materialize managed data without copying hidden state or preserving traversable identity between operations.

## Proxies in managed storage

Host-supplied Proxies may represent managed records, Arrays, or declared managed
classes only while they obey the managed-data contracts. A Proxy does not by
itself make an identity external; ordinary admission and declarations determine
its category.

Each primitive property write, definition, or deletion on managed storage must
implement the requested operation with ordinary property and Array semantics
on success. If it fails, the represented graph must remain unchanged. This
includes a `set`, `defineProperty`, or `deleteProperty` trap that throws or
reports failure; changing the underlying data before failing is unsupported.
The rule lets Cascada retain the old placement version and refcount state when
the physical operation fails. It applies to each primitive storage operation,
not to a whole Cascada command: earlier successful operations need not roll back.

Ordinary managed methods may mutate their working receiver and then throw or
reject; receiver isolation, validation, and poisoning govern that boundary.
An opaque external identity follows external-operation semantics instead:
authorized mutation, including property mutation through a Proxy, may leave
completed effects when it fails and poisons the selected mutation scope. This storage
restriction imposes no rollback requirement on external state.

Cascada trusts this contract. It adds no Proxy detection, speculative writes,
rollback, or recovery guarantee for violations. Supported storage failures
remain ordinary language Errors. Runtime-created Proxies used for internal
control, such as Array remapping, are implementation machinery rather than
host-supplied graph data and remain available.

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
placement, Promise version, or frontier includes any supported thenable; **native
Promise** means the built-in JavaScript mechanism specifically. A supported
custom thenable:

- exposes a callable `then` whose identity and behavior remain stable while Cascada may use it;
- represents one outcome, supports every subscription Cascada makes, invokes at most one supplied callback once per subscription, and gives every subscription that same outcome;
- delivers callbacks in subscription order, including across settlement: a later
  subscription to an already-settled value cannot overtake an earlier
  subscription whose callback has not yet been delivered;
- may invoke a callback synchronously when its outcome is already available; and
- returns the callback result directly when it invokes the callback synchronously, or a supported thenable representing that callback's eventual result when delivery is pending.

If a callback delivered before its own subscription returns throws, that throw
escapes that `then` call synchronously. Once a subscription returns pending, a
later callback throw rejects its returned chain, including when another
subscription drains that older callback synchronously. Catching that older
throw to reject its chain is required; swallowing a throw from the currently
supplied synchronous callback is unsupported. An implementation that cannot provide this
sync-first chain contract should expose a native Promise instead.

A custom thenable delivers a final non-thenable fulfillment value; it owns any
nested assimilation before invoking the fulfillment callback. Native Promises
retain native assimilation. This contract admits Cascada's sync-first resolved
values and rejecting expression containers without imposing a microtask on ready work.

Cascada invokes `then` through its common continuation helper at the operation's
program position. The thenable itself owns subscription storage, settlement,
and FIFO delivery. Cascada does not cache `then`, canonicalize the thenable onto
another Promise, maintain a parallel subscriber queue, or inspect the object
returned by `then` as shared settlement state. A synchronous callback is
processed in the same turn; Cascada adds no microtask merely to normalize it.
The `then` invocation is a trusted scheduling protocol, not a general external-code
callback: its implementation performs its own subscription, delivery, and
chaining work, and must not call back into Cascada synchronously except through
the supplied callbacks. Cascada does not add state merely to diagnose violations
of that contract. At subscription exit, on return or throw, it checks the
subscribing operation's execution and propagates any authoritative fatal before
processing the result. No-op rejection subscriptions use the same boundary;
their handlers retain rejection ownership after failure. This adds no queue or
restriction on valid delivery of older pending callbacks.

After consuming a possible thenable, Cascada derives readiness only from the
returned transition result. A transition that finishes synchronously returns
its direct result; one whose required work remains unfinished returns its
pending chain. Cascada does not infer readiness from whether a callback ran or
whether that callback wrote into a Promise version, aggregate slot, receiver, or other
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
machinery for these cases. A failure that ordinary supported-external-action boundary
handling observes is still classified normally; undetectable ordering violations
remain host-contract violations.

## Errors

A script reports a recoverable Error only when its returned data is poisoned. Errors propagate through the data and the defined mutation effects; there is no execution-wide recoverable-error history or separate list of operation failures that the script must check. Repair and replacement with fresh data may remove poison, as in `if x is error: x = default`. Complete Error collection means collecting every Error required by the currently consumed data, not retaining failures that no longer contribute to the output. Fatal execution failure remains separate.

Failure payloads are diagnostic data. An exact native cause may retain its native stack, code, diagnostic fields, and nested native cause. It must not retain a protected managed receiver or argument, or a mutation-capable external identity, through any field, prototype, or nested cause. For example, `throw this` from a managed method and `throw Object.assign(new Error("failed"), { receiver: this })` violate this contract. Cascada retains compliant causes exactly and does not traverse, copy, or deep-freeze their graphs; freezing the poison wrapper cannot isolate a mutable cause. Kernel-created validation reasons contain only diagnostic facts.

`PoisonError` is recoverable language data. It records an opaque source context, a stable failure kind, and the exact raw cause. Once contextualized, it propagates by reference without changing its source. Separate introductions may construct distinct immutable wrappers. Collection treats wrappers as equivalent when their raw cause, source-context identity, and kind match; physical wrapper identity is not a cross-construction guarantee.

`CompoundPoisonError` contains flattened leaves in `.errors` and preserves each retained leaf's attribution. `getErrors` returns null for no Errors, the unchanged leaf for one distinct Error, or a compound for several; pending completion fulfills with that ordinary result. It and compound construction use the same semantic deduplication rule above, with unspecified order and no persistent Error cache. Different source contexts or kinds remain distinct even when the cause is the same. A present cause is compared even when it is `undefined`, `null`, `false`, zero, or `NaN`; causeless validation leaves use their own identity and remain distinct.

Both poison types are ordinary non-thenable **graph Errors**, recognized synchronously with `isPoisonError`. Normalized graph operations return or fulfill with them as data. The separate expression-facing PoisonedValue is not an Error; it retains one Error in `.error` and rejects await/native assimilation with that Error. Public `lookupPathForExpression` accepts only string, number, boolean, and bigint (ExpressionValue), rejects Null, undefined, Symbols, and non-primitives, and returns `ExpressionValue | PoisonedValue | Promise<ExpressionValue>`; it performs no object coercion or descendant traversal. Input consumption converts a supplied expression failure to its ordinary Error before graph admission, preserving source and cause. Raw native Errors acquire attribution at their causal boundary and are recognized before any `then` property is read. Diagnostic views are separate safe non-thenable data.

`FatalError` represents an execution-ending internal defect, broken invariant, or unsafe
host failure. It is reported and rethrown, never treated as language data.
Kernel-created Error wrappers and compound child arrays are frozen after
construction, so exposing an Error cannot mutate later graph attribution.

Imported host storage keeps nested native Error objects unchanged while Cascada
exposes their contextual wrappers as the logical property values. Declaration
APIs are outside the graph and therefore return a supplied Error unchanged. No
language Error is exported to external code.

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

After host-owned managed data is passed to Cascada, application and external code must not mutate its original managed identities. External leaves retain their separate authority and ordering contract. Cascada borrows that storage and preserves its logical value through copy-on-write; it does not make concurrent host mutation safe.

This restriction follows the original identities even if Cascada later copies them. Mutate managed data through Cascada operations or mutate a host-ready copy produced by export.

Managed values move between independent Cascada executions only through export followed by import. Do not pass an execution's internal managed identity directly into another execution. External code can independently supply the same exact external identity to several executions, but Cascada cannot coordinate those executions. Share it only when it is observation-only; a mutation-capable external identity must belong to one execution.

### Mutation scopes and ownership

A `!` prefix does not change managed ownership or classification. Managed lookups, retained parents, and assignment inputs use ordinary sharing and COW, including when they contain external identities. Managed native methods retain their normal preparation, isolation, and publication; source metadata remains valid because external owners cannot mutate admitted managed identities. Ordinary pending values and Errors keep their managed semantics.

External mutation is confined to state owned by the selected first external boundary. A reference through `this.child`, a parent link, or a closure does not make managed data or a separate external resource part of that ownership. A wider managed `!` prefix does not grant such permission. Hosts must not supply managed identities that they will continue mutating through an external alias; import preserves ordinary managed aliases rather than trying to normalize or discover hidden native references.

The `!` prefix selects the poison scope independently of native ownership. If `api.managedContainer!.externalApi.someCall()` fails, `managedContainer` becomes poisoned while its underlying data and external binding are retained. Subsequent operations cannot pass that guard and return its existing poison until the container is repaired. Do not additionally poison `externalApi` for that failure. A marker at or inside the external boundary instead poisons that boundary's phase. Previously captured managed values retain their snapshot semantics, but an entered Chain's live external access must still obey the originating context's current ancestor guards.

The same ordering restriction covers reads of another mutable external owner. An observation wrapper, getter, or method must not secretly read a separately ordered mutable resource: its phase would not wait for that resource's mutations. Use a separate contextual operation and pass detached data, or expose the combined resource through one external owner. Immutable configuration and read-only references to protected managed source storage need no additional external authority; a raw managed reference is not a view of later COW updates.

When native code needs to mutate plain data together with a service, declare their owning record external before import. That complete externally owned graph uses its boundary's ordering and property snapshots. Its surrounding managed parent stays managed. A mutable external property read returns a detached managed copy; retaining the parent leaves its external references opaque and grants no use at another location. Native export rejects mutable capabilities.

## Runtime primordials

Cascada assumes the global `Array`, `Array[Symbol.species]`, the standard Array intrinsics, `Array.prototype`, `Promise`, `Promise.prototype`, `String.prototype`, `Object.prototype`, `Error`, and standard Error prototype chains are not modified. Otherwise native dispatch, inherited indexes, accessors, species, protocols, or Error classification could change controlled behavior.

Custom or replaced methods and accessors on `String.prototype` or `Object.prototype` are unsupported through native String dispatch. Cascada never invokes those accessors while selecting a String method.

A boxed String's own character indexes and `length` are not method candidates. `Object.prototype.__proto__` is an accessor, so it is unsupported and never invoked.

## Logical Arrays

Sort comparators must return a Number synchronously. A returned Promise/thenable is an invalid callback result; the selected callback boundary owns its rejection. This does not subscribe to forbidden thenables merely found during declarations or managed-receiver validation.

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
- A host comparator must run synchronously and return a Number. An Error is its Error outcome; a Promise or any other result is invalid. It may mutate or retain its exported managed argument copies, but exact Functions and external identities remain read-only. It must not synchronously re-enter the same execution.

Use a managed class rather than an Array subclass or custom Array prototype when data needs application-defined methods.

## Managed records and classes

A managed record exposes only own enumerable Function-valued data properties as methods. Inherited Functions, accessors, non-enumerables, and extracted Functions are not record methods.

A managed class has these additional restrictions:

- Its semantic state uses only own enumerable string-keyed data properties.
- Its prototype chain up to `Object.prototype` may contain accessors, but they are not Cascada methods. It contains no callable or accessor `then`.
- It does not depend on private fields, Symbols, non-enumerables, accessors, native internal slots, mutable closure or module state, parent state, or hidden shared mutable storage.
- Constructors are not run when Cascada copies an instance.
- External code does not change its prototype chain, descriptors, or extensibility after admission.

Changing a prototype after admission violates the host contract, but violation is not itself proof that the runtime is corrupt. If method selection detects an accessor, callable `then`, or another invalid prototype shape before invoking external code or publishing receiver state, the call returns `InvalidManagedReceiver` and preserves the original receiver. It becomes fatal only when the change has already made runtime state, ownership, ordering, or publication untrustworthy.

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
- A direct Error always reports method failure, whether returned, fulfilled, thrown, or rejected. A mutating call applies its selected scope's failure behavior; returning an Error as successful payload is unsupported. A managed scope containing fixed native bindings retains its pre-operation value under a poison guard so repair can restore access without moving the resources. Ordinary managed scopes without such bindings keep their normal Error-value behavior.
- Detached receiver or external-input work is forbidden. A Promise nested in a synchronous result must not later access or expose the receiver, or inspect or mutate an exact external input; return that Promise directly when its completion needs such access. Exact observation-only external identities may be retained or returned inertly because this grants no authority. The managed structure of exported argument copies may be retained, used, or returned later; exact external leaves inside it follow the same rule. Synchronous re-entry into the same execution is forbidden; a separate script execution may start immediately, and independent work in this execution may start after the host call returns with its own explicit operation context.

Nested calls such as `this.increment()` are ordinary JavaScript calls on the already prepared receiver and follow the same outer invocation contract.

## External state

External identities are exact host objects. Cascada observes them by default and mutates them only through an explicit mutation operation: a marked call, assignment, or deletion under valid authority.

### Mutation location

Only mutation-capable external identities have fixed context bindings and ordered phases. Observation-only external identities need neither a fixed namespace nor a mutation lock; their read-only host contract permits dynamic paths and changing managed placements.

A mutable external boundary can be selected only through its static source path. Literal String/Number keys are static; a computed key is dynamic even when its value is already ready. A dynamic key after the first external boundary does not change the selected owner and remains supported. A Promise-valued input key may likewise delay a suffix within that already selected owner; native intermediate property values must still be ready.

For a managed `api` containing mutable external `db`, `api.db!.addUser(1)` supplies the compiler path `["api", "db"]`. `api[getDbApiSynchronously()]!.addUser(1)` cannot select that resource, even if the function returns the string `"db"` directly or through a synchronously settling thenable. The compiler cannot infer a static resource path from a call's result. Initial context discovery never executes a key expression, and later evaluation cannot turn its result into a static declaration.

Forbidden dynamic selection returns an operation-local external-location validation Error without host access or a candidate phase. An observation poisons only its result. A mutation publishes at its already-selected managed `!` scope, or at the longest static managed prefix when its intended scope lies beyond the first dynamic segment. This failure location is fixed by the source path, not by when validation detects the problem. Never poison a guessed resource or all possible external candidates. Existing prefix poison takes precedence and propagates unchanged.

The paths connecting registered mutable external identities form a fixed namespace in their originating context. Whole replacement/deletion of those nodes, remapping their resource-bearing structure, and arbitrary managed mutating methods whose receivers include them are unsupported and rejected before effects. Ordinary managed children beside that namespace remain mutable; physical COW can preserve the same namespace bindings. Scope entry, poison, and repair retain the namespace rather than replace its identities. These restrictions do not attach to managed identity aliases stored outside the originating context.

For example, if `ctx.api.db` is a registered mutable external boundary, a managed mutating method on `ctx.api` is forbidden even when that method intends to change only `ctx.api.label`. Direct assignment to `ctx.api.label` and managed mutating methods on an ordinary sibling such as `ctx.api.settings` remain supported. The runtime enforces the receiver restriction before invocation rather than inspecting arbitrary method effects afterward.

Every external identity that Cascada may mutate must be directly accessible under a compiler-provided static mutation path in the original context data: one context Chain and one complete normalized path. The root and every value on the path to that boundary must be non-Promise and non-thenable. This excludes already-fulfilled Promises and synchronously settling custom thenables. Discovery skips such branches without consuming them, awaiting them, or following their imported outcomes. The complete tree is ready before ContextChain construction returns and is never extended by delivery. Ordinary managed data may still contain thenables; skipping a discovery branch does not reject otherwise valid data import.

- The compiler supplies a tree of potential mutation access prefixes without classifying host identities: receiver routes for calls, containing routes for property writes/deletions, and selected routes for repair-only. Only source-static prefixes are included; `!` selects poison scope independently. Initial import follows only those named properties and retains first external boundaries and their connecting branches. It performs no managed subtree search. [Compiler construction rules](integration.md#compiler-construction-of-the-mutation-access-tree) define the format.
- Initial import records only directly accessible external boundaries. Mutation paths containing no such boundary are discarded. An external identity available only through Promise or thenable delivery receives no authority at that path, regardless of delivery timing. Other direct paths are discovered normally. Later attempted mutation without an authorized location fails recoverably; discovery creates no deferred registration or blanket context poison.
- Every supported call or property operation on a mutation-capable external identity must use its registered context Chain and one fixed normalized path. A regular Chain retaining the identity acquires no external mutation authority.
- Access through a regular Chain or another unregistered location fails locally before host access, even for an observation; it does not poison the valid context binding or its external phase. Competing independent context registrations instead invalidate the shared authority once the conflict is known, without choosing a permanent winner by arrival order.
- Initial context import rejects one exact external identity at two distinct compiler-selected boundary paths with `ExternalLocationConflict`, including explicit routes through managed aliases or cycles. The complete initial segment fails before registration, leaving existing bindings unchanged. Shared compiler prefixes and native suffixes under one first owner produce only one record. Inert occurrences outside those selected routes make no claim; future off-path use still fails locally. See [duplicate candidate paths](external-context-ordering.md#duplicate-candidate-paths-within-one-context).
- Managed assignment creates another owner rather than JavaScript reference semantics. Later mutation through either managed placement uses COW and cannot change the original live binding.
- Another reference may be stored elsewhere, including at another Array index, but off-path external use through it fails locally and grants no authority.
- A later Cascada gate may temporarily hide the original path without changing it.
- A mutation-capable external identity cannot be passed as a host argument, external write value, or controlled-callback input. Export returns an Error before external code runs and records no use. Observation-only external identities may cross unchanged and remain read-only.
- Import, managed-graph assignment, storage, export copying, and return do not count as use or transfer authority. Actual use of a stored alias still conflicts when reached.
- Waiting creates no new mutation location. A known static location behind an earlier managed gate reserves its phase when that gate permits access; an unrelated identity revealed later gains no authority. If it conflicts with a registered mutable identity, access fails before host work.
- External identities never recorded in an external mutation tree are observation-only and may be observed from any location. Their aliases are the developer's responsibility because Cascada provides no mutation ordering for them.
- Public `import(value, operationContext)` creates no external mutation tree or mutation authority. `operationContext` carries the execution and source-error information. An unregistered external identity remains observation-only; an identity already registered in this execution keeps its binding and access restrictions through every import or alias. Import cannot downgrade it to freely observable data. Mutation-capable context state must enter through `ContextChain` initialization.

A `!` prefix declares the complete mutation scope without changing ownership. A managed prefix keeps its ordinary managed transition; an external host effect belongs to the reached first external boundary only. A conflicted leaf remains an inert discovery fact without disabling other valid boundaries. A managed method receives no authority over external descendants, and an external method receives no native mutation permission over managed data or separately owned external siblings.

A `!` attached to a method call selects that method's receiver. Moving it to an earlier receiver prefix broadens the scope; the method Function itself is not graph state or a separate ordering scope.

An external identity is opaque. A `!` written deeper inside it still selects that first external boundary: if `apis` is external, `apis!.db.write()` and `apis.db!.write()` share the `apis` ordering scope. Put independently ordered external identities such as `db` and `cache` in a managed parent when they need separate scopes.

### Identity and hidden state

- One mutable host resource must have one external identity. Do not expose the same resource through multiple wrappers or independently scheduled roots.
- Cascada does not scan external graphs for aliases or shared descendants. Hidden access to another mutable external owner's state, including read-only access through a wrapper, violates the single-owner ordering contract.
- Application code must not independently mutate or replace external state while Cascada may access it.
- Mutation-capable external APIs should be stable context resources, such as databases, web services, or LLM clients. Do not move, replace, or delete their original context binding after initialization.
- External state may retain a read-only reference to an admitted managed identity. That reference grants no permission to mutate the managed object, even within a declared `!` scope. Mutable-external property observations copy its logical data; a direct native call or write on a managed receiver reached through that alias is rejected. Use the managed path for its operations. Cascada does not inspect closures, private fields, or unrelated external properties to find hidden references.
- A newly admitted identity read from observation-only external property state remains external even when it is a record or Array; existing admission and binding facts are never overwritten. Reading inside mutable external state instead produces a detached managed copy that preserves prototypes and Functions. Any copied class-like value must satisfy the managed-class state and method restrictions; native/internal-slot objects that cannot survive structural copying must be returned independently through a host method or remain observation-only external state.
- Managed state may contain external identities, subject to the opaque-leaf managed-method rule above.

### External operations

- An external observation must not mutate its receiver.
- An external mutation may mutate only state owned by its selected first external boundary. A nested native receiver inside that boundary uses the same ownership and ordering; a managed ancestor or separately owned external sibling remains outside it. Exact external arguments grant no mutation authority and remain read-only; exported managed argument copies are independent host data.
- A property read crosses into Cascada through ordinary import when the external state is observation-only. A read inside mutable external state instead returns a detached managed snapshot. A property write crosses into external code and its value is exported first.
- The detached copy has the same visible graph-copy semantics as export: it preserves Arrays, aliases, cycles, prototypes, and Functions and may therefore expose supported managed methods without exposing the mutable external source. A Promise returned directly by the selected property may resolve before copying, but the copied graph itself must contain no Promise.
- An admitted managed source contributes its logical properties and Array structure, including ready placement-version values, rather than its physical storage. Every required nested value must be ready when copied. An unresolved logical property or managed gate is invalid snapshot data, just like a nested host thenable; the snapshot does not subscribe, wait, or expose partial output. This ready-data restriction also applies when continuing a property path through an admitted managed source. Use ordinary managed operations when pending managed data must be consumed.
- A managed parent is retained through ordinary sharing and COW, without reading or copying its external interiors. Opaque external references remain inert without authority at the new location. Access through another location fails before host work, and export rejects a mutable external capability wherever it occurs in traversable data.
- Method results use ordinary import, not the mutable-property snapshot rule. A host method that returns an object to become managed must relinquish mutation of that identity or return a detached copy. Merely snapshotting a different observation does not make a managed source safe for native mutation.
- External Arrays and native collections use this host-method contract, not the controlled managed Array algorithms. Mutation mode must match the native method's effects. Inside mutable external state, a method returning its exact receiver is rejected, including native `reverse` or `sort` in mutation mode; completed effects remain and the failure poisons the phase. A shallow result such as `slice` over mutable object elements is not detached: use a host method that returns an independent graph, relinquish the returned storage, or read a property snapshot. Cascada does not insert automatic callback export or borrowed-result copying into arbitrary native methods. A genuinely observation-only external receiver may return itself unchanged; it remains read-only and gains no authority.
- Assignment and deletion are mutations even without `!`; their default mutation scope is the exact target placement. An explicit ancestor `!` broadens that scope. A selected scope inside external state clamps to its first external boundary; an explicitly selected managed ancestor remains the scope.
- Replacing `ctx.db` changes a managed placement even when its old value is external. Changing `ctx.db.name` is an external property operation when `ctx.db` is external.
- A native setter must finish synchronously.
- All mutations inside one mutable external owner are exclusive across its entire native graph. Assigning resource.a = pendingValue reserves that owner before waiting for the value, finishes export and the native write, and only then releases the phase. A later write or read of resource.b waits even though b is unrelated. Consecutive observations after that mutation may overlap; the next mutation waits for all of them. No native property receives a runtime gate or Promise placeholder, and the ordinary assignment return still signals issuance rather than completion.
- Inside external state, intermediate path values must be ready native values. Cascada never awaits a Promise to continue a native property path or obtain a method receiver/callable. Only the final value read by lookup, or the direct result of an invoked method, may be a Promise; its result boundary consumes that Promise before import or snapshotting. A Promise nested inside the final snapshot graph remains invalid.
- Native property lookup, assignment, and deletion are supported under their ordinary authority and ordering. For external `x`, looking up `x.promiseProperty` may consume that final Promise, and `x.promiseProperty = value` or `delete x.promiseProperty` replaces or removes the property without reading or consuming its old value. Traversing `x.promiseProperty.y`, including assigning or deleting `y`, fails without subscribing to the intermediate Promise. Assignment exports the new value before the native write; it never installs a Cascada Promise version in external storage.
- An authorized external mutation may leave completed effects when its method, setter, or Proxy trap throws or rejects. Failure poisons the selected mutation scope; it does not roll back those effects. The managed-storage Proxy restriction does not apply inside an opaque external identity.
- External mutation authority is never transferred through lookup, assignment, an argument, export, storage, or return.

### Entry

Entry into mutable external state selects only the whole first external boundary through a static path. Compiler lowering enters that whole resource even when a delayed conditional changes a deep property such as `resource.startPosition.x`. The entry is an exclusive control-flow scope: outside access waits at its context-binding gate while the callback issues its operations, which use ordinary external phases. This also applies to a read-only callback; it does not authorize writes through a read-only entered Chain. Entry preserves the exact resource rather than importing its native child as managed data. Observation-only external objects require no mutation lock. Managed entry retains its ordinary fine-grained placement behavior.

A request to enter a property beneath a mutable external boundary produces PropertyValidation poison attributed to that entry and never invokes its callback or creates native child storage. Compiler lowering must avoid such requests, but this particular lowering defect is recoverable rather than fatal. Check it once where entry selects its target, respecting existing ancestor guards and external phase order. Read-only entry failure affects its result; mutating entry failure poisons the selected external scope without replacing its exact native binding. Existing poison propagates unchanged. Do not silently widen a malformed entry request.

### Repair

Cascada does not store language Error values in native external properties or replace the exact external object with poison. An assignment containing an Error fails export before the native write and poisons its selected mutation scope. Without an explicit managed ancestor scope, the property mutation clamps to the external boundary and poisons its phase; with such an ancestor scope, only that managed guard is poisoned. The native object remains at its fixed binding. Native code may have its own Error objects in opaque state; reading or returning one follows the ordinary causal failure boundary.

External mutation failure poisons its selected ordering scope rather than replacing the external value. Both observations and ordinary mutations encountering existing poison return Errors without host access and preserve that poison. An observation's own failure, including snapshot or reflection failure, affects only its result. An observation never publishes new scope poison. An unauthorized mutation never poisons a guessed external boundary or the legitimate scope reached through another location. It follows its local managed failure effect; forbidden dynamic selection uses the already-selected managed scope or longest static managed prefix defined above. Cascada's `!!` syntax lowers to one of two runtime operations:

- `apis.db!!` issues an exclusive repair-only operation. It clears poison for the selected external scope, performs no host access, has logical result `undefined`, and is harmless when the scope is already clear.
- `apis.db!!.close()` issues one exclusive repair-and-call operation. It bypasses old poison and calls `close()`; success leaves the scope clear, while failure stores the new Error as poison.

- `api.managedContainer!!` repairs a managed scope retaining external bindings. It clears that scope's guard and exposes its retained data without invoking native code. `api.managedContainer!!.externalApi.someCall()` repairs-and-calls under that same selected scope. Neither form repairs external children independently poisoned by earlier operations. A deeper repair cannot bypass a poisoned ancestor.

Repair requires the selected scope's original context location. Another occurrence cannot repair it. Repair does not record use, establish authority, clear permanent location conflict, or remove ordinary Error values stored in application data. There is no repair-and-observe, repair-and-assign, or repair-and-delete operation.

Ordinary assignment replaces, and deletion removes, an Error value at their final managed placement. This needs no repair marker. A retained managed-scope guard or external-phase poison is different: ordinary operations cannot pass or clear it, including by assigning a fresh value at the guarded scope. Explicit repair clears that guard while preserving fixed bindings. An Error or guard in an earlier path segment still propagates.

A repair marker inside opaque external state selects the first external boundary, just like mutation. If `apis` is external, `apis.db!!` repairs the `apis` ordering scope.

A repair whose predecessor and repair transitions complete synchronously produces `undefined` directly. Otherwise it produces a Promise for `undefined`; a native predecessor subscription defers delivery even after that predecessor has settled. The following Cascada operation can still be issued immediately and is ordered after the repair.

## Boundary values and external code

Host data entering Cascada's language graph is imported. Data leaving the graph for host JavaScript is exported. A synchronous scalar callback result used only to control its operation is validated by that callback's contract instead of entering the graph.

- Import is used for host roots, supported host-call and callback results that enter the graph, external-property reads, and later Promise fulfillment from those boundaries.
- Export is used for native-call arguments, controlled callback inputs, external-property writes, and script results.
- External native properties remain opaque to graph export and Error collection. Contextual `hasError` and `getErrors` observe runtime-owned poison at the selected mutable external scope in phase order, without reading native properties or extracting the capability. A healthy scope yields `false`/`null`; a poisoned scope yields `true`/its original Error. Binding conflict is also an Error, never a healthy terminal. Ancestor contextual queries include accessible descendant scope Errors. A poisoned guard is terminal: its retained children are recovery state and are not traversed. Ordinary copied aliases gain no live scope-query authority. Read a native property through an ordinary lookup before exporting or querying its data.
- Exported managed records, Arrays, and class instances are independent host data. Class copies preserve their admitted prototypes without running constructors. External code may mutate or retain the copies without changing their Cascada sources.
- Functions and external identities cross exactly. External code must treat them as read-only unless the exact external identity is independently covered by the active receiver mutation scope.
- Export consumes Errors at any depth. If any argument or assigned value contains an Error, external code is not called and no Error crosses the boundary.
- External code may retain exported copies. It must not retain access to an unexported managed receiver or source.
- Host methods, accessors, controlled callbacks, and reflection hooks must not synchronously re-enter the same execution. Attempted same-execution re-entry is fatal because the outer transition has not yet published an ordering point. A host function may start a script under a separate execution, while compiler-controlled script calls and recursion remain internal work and do not enter the external-action boundary. Trusted runtime control-flow callbacks such as `enter` follow their explicit gate/lease and closure contracts instead.
- A direct result Promise may keep using its receiver and exact external inputs until it settles. A nested result Promise does not extend that authority, though it may carry an exact external identity as inert result data. The managed structure of exported copies may outlive either Promise; exact external leaves gain no later authority.
- A direct host Promise must not depend on a nested Cascada operation ordered behind that call's active managed gate or external phase. Such a dependency is a self-wait and is invalid host behavior.
- A callback invoked by a controlled method must complete synchronously and must not return a Promise. It receives only its declared exported inputs and may not access an unexported managed source.

## Choosing a representation

- Use a record for ordinary managed data without inherited behavior.
- Use a managed class when state needs application-defined methods or when large records would be copied frequently.
- Use a logical Array only for indexed data and supported controlled methods.
- Use external state for live host resources, native objects, APIs, databases, streams, handles, and state that Cascada cannot fully own.
- Keep immutable values external when they need native identity or unsupported internal state, such as a `Date` used only as a value.
