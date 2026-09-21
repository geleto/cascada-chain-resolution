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

The external case violates the single-context-location input contract. It does not authorize mutable sharing in a successful program or promise that both import calls can be rejected before either context is used. Independent imports have no guaranteed invocation order. A regular Chain creates no competing mutation binding; invalid access through it must not invalidate the context binding. An inert regular-Chain occurrence imported earlier does not disqualify the context. Earlier off-path access or exposure before any mutation binding is known cannot be retroactively rejected or repaired by rewriting a retained placement; such use of an identity intended for contextual mutation is already outside the single-location contract. The agreed reverse-import-order and lazy-access policy is specified in [external-context-ordering.md](external-context-ordering.md#identity-binding-map).

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
the physical operation fails. This contract applies to each primitive storage operation; it does not permit a failing trap to alter its input. The enclosing managed mutation preserves its baseline and discards failed working state; earlier successful Cascada commands remain committed.

Ordinary managed methods may mutate their isolated working receiver and then throw or reject. The runtime discards that failed working state, poisons the selected scope, and retains its pre-operation logical value for repair.
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

A managed mutation scope must not cover canonical registered mutable external locations. Use the external tree at the selected context route to enforce this restriction; reject an invalid mixed bang scope before mutation and poison that scope, retaining its value for repair. An external reference stored elsewhere is inert: its presence alone does not forbid controlled managed assignment, deletion, or Array operations. Copying or retaining such a reference grants no external observation or mutation authority. Observation-only external identities remain permitted opaque leaves. Managed lookup, import, assignment inputs, and retention still use ordinary sharing, leases, versions, and COW; a bang never promotes managed storage to native-writable data.

For example, if services.db is a registered mutable external location, services!.count = 1 is an invalid mixed scope, while the ordinary sibling write services.count = 1 remains valid. A retained managed copy at another location may use copy!.count = 1 even though it contains the same inert db reference. Use of copy.db as an external receiver still fails locally and does not poison services.db. Native managed calls consume their complete receiver, so preparation must reject any registered mutable external identity in that receiver, including an inert alias. Controlled operations do not scan or await unrelated data to establish that an inert alias is absent.

An external mutation selects one registered external scope and may change only its owned native subtree. Nested registered scopes permit sibling concurrency and parent-wide exclusion. Managed parents, siblings, and aliases are not accessible to the native method through raw references. Arguments use the ordinary export/ownership contract regardless of their source path. External methods do not recursively prepare managed aliases hidden inside native state.

Entry is an access reservation, not mutation authority. It may select a mixed branch and protect its managed placement and external descendants. Every operation issued through it must still obey the bang restrictions. Ordinary sibling paths outside the entry remain available. Gate installation itself uses path COW where required to preserve another owner's logical placement.

Mutation failure poisons a scope that covers the affected logical structure. In particular, publishing failure at a missing Array index must not grow its length: poison the owning Array instead and retain its complete pre-operation structure for repair. An explicit broader mutation scope remains the owner. In-range element failure can remain local when it affects no Array structure. This does not require poisoning every ancestor merely because it contains a failed child; see [managed structural effects](error-handling.md#managed-structural-effects).

Each managed mutation preserves its selected scope's logical value at its ordered turn, before any write, using existing ownership and COW. Success publishes the working state. Failure discards it and publishes scope poison in owning-placement metadata while retaining the baseline for repair, regardless of whether the value was previously shared, leased, imported, or exclusively owned. The Error contains no recovery data. Ordinary Error data and an independent Error result from a successful mutation remain distinct. External failure keeps native state and completed effects, with poison in the external tree. [Scope transitions](error-handling.md#scope-transitions) define publication and repair. Further operations blocked by that scope poison preserve the same Error and original recovery baseline; one repair restores that baseline regardless of the number of blocked attempts.

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

Method selection rejects accessor methods without invoking them. Receiver validation rejects an unsafe native `then` lookup before publishing the candidate. Changes to admitted prototypes remain unsupported and carry no diagnostic or recovery guarantee.

Do not declare native internal-slot types such as `Date` managed. Their prototype can be preserved, but their hidden state cannot be reconstructed in a copy. Keep them external, and explicitly declare a nested identity external before a surrounding `managedState` walk reaches it.

These restrictions allow records and class instances to share one managed invocation model.

## Managed method contract

- The call mode must describe the method correctly. An observation does not mutate its receiver; a method that may mutate the receiver must use mutation mode.
- A method may change its exported managed argument graph in either mode. It may change its managed receiver only in mutation mode, and must not mutate unrelated exact state.
- All explicit managed arguments are exported together into one host graph independent from their Cascada sources. Aliases across argument positions remain aliases. A method may mutate, retain, store, or return that graph without changing the Cascada sources.
- Managed receiver state and exported managed arguments are separate graphs. A method must not rely on a managed argument retaining an identity relationship with `this` or one of its properties across the boundary.
- Functions and external identities remain exact when exported and are read-only as arguments. Passing or retaining one never grants external mutation authority.
- Every managed record or class method keeps mutable semantic state in `this` and receives other state through explicit arguments. It must not read or mutate mutable parent, closure, module, or other state outside those inputs.
- External identities inside a managed receiver are opaque leaves. A method may retain, compare, return, or add another reference to observation-only identities, but it must not inspect or mutate their host state. A mutating managed receiver cannot contain registered mutable external identities. It may replace or remove an observation-only identity, but must not move, replace, or remove a mutation-capable identity recorded at a live context-tree leaf.
- Access mutable external state through a separate Cascada operation selecting an external scope, such as `api.db!.close()`. A managed `api!.close()` cannot contain registered mutable db, and `api!.db.close()` is invalid when api is managed. An external api may select its whole native subtree, subject to fixed nested locations.
- A completed mutation receiver contains no Promise, supported thenable, or Error. Validation rejects a stored thenable without consuming it, even if it could deliver synchronously. Managed state may contain these values between calls, because Cascada resolves or propagates them before the next managed invocation.
- A managed method may complete synchronously or through one direct Promise. Later receiver access and any inspection of a read-only exact external input must belong to that Promise and finish before it settles.
- A direct Error always reports native method failure, whether returned, fulfilled, thrown, or rejected. A managed mutating call discards its private changes and retains its pre-operation scope beneath placement poison; an external call poisons its scope without native rollback. An invalid mixed managed scope is rejected before invocation and retains its unchanged baseline. An independent result Error from a successful controlled mutation does not roll back its effects.
- Detached receiver or external-input work is forbidden. A Promise nested in a synchronous result must not later access or expose the receiver, or inspect or mutate an exact external input; return that Promise directly when its completion needs such access. Exact observation-only external identities may be retained or returned inertly because this grants no authority. The managed structure of exported argument copies may be retained, used, or returned later; exact external leaves inside it follow the same rule. Synchronous re-entry into the same execution is forbidden; a separate script execution may start immediately, and independent work in this execution may start after the host call returns with its own explicit operation context.

Nested calls such as `this.increment()` are ordinary JavaScript calls on the already prepared receiver and follow the same outer invocation contract.

## External state

External identities are exact host objects. Cascada observes them by default and mutates them only through an explicit mutation operation: a marked call, assignment, or deletion under valid authority.

### Mutation location

Mutable external scopes are registered at fixed context locations. Observation-only external data needs neither registration nor locks. Each registered location must be directly accessible through original own data properties, with no Promise, thenable, or accessor on its route. This excludes synchronously delivering thenables too. Ordinary import may consume such availability, but discovery never follows its outcomes or adds nodes later.

Registration commits during initial context import, before the first observation or mutation. From that point, use through a copy or unrelated alias fails even if the original context location has never been used. An authorized entered route retains the original location's authority; copying managed data does not transfer it.

The compiler supplies finite static receiver paths for mutations, containing paths for native writes/deletions, and repair paths. Initial import follows only these named routes. It retains external nodes and their connecting paths, including requested nested external objects below a first external boundary. Managed endpoints disappear; an already-managed identity is never reclassified by discovery. Requested native child values newly admitted for registration remain external. Duplicate selected locations for one exact identity fail the initial import atomically. No discovery subtree search, late registration, or alias scan is performed.

Supported reflection failure while reading a compiler-named native data placement during discovery produces ImportReflectionFailed at context import and commits no partial tree, admission, or binding changes. Discovery does not enumerate native properties or invoke getters.

Every selected or crossed registered external node requires a source-static path. Literal String/Number keys are static; computed ready Strings and synchronously resolving keys are not. Dynamic input keys remain usable inside unregistered native suffixes, but cannot select another registered descendant. Native intermediate property values and method receivers remain ready; only final read values or direct method results consume availability.

For external apis with registered config and db, config mutation and db mutation overlap. A mutation selecting apis waits for both and blocks later descendants. A parent observation waits for child mutations and blocks later child mutations. Ordinary observations overlap. Scope selection uses the explicit bang prefix when present, otherwise the deepest registered scope covering the operation's receiver/container. A bang inside an unregistered native suffix uses its enclosing registered scope. Entry into a registered descendant is valid; explicit entry into an unregistered native property is not.

Forbidden dynamic observation returns local ExternalLocationConflict before host access. A forbidden mutation poisons its already-selected scope, or deterministic static managed fallback when no external scope was selected, without reserving guessed children. Existing poison takes precedence. A shared prefix containing registered siblings does not forbid unrelated dynamic managed or observation-only paths.

Registered identities and connecting placements cannot be replaced, removed, or moved by reset, Array remapping, assignment, deletion, or any native method. Ordinary unregistered child objects and Arrays may be replaced within the selected authority. Managed namespace parents may retain ordinary mutable siblings, but cannot be selected as bang mutation scopes when their canonical route covers registered locations. COW, entry, guard poisoning, and repair preserve fixed identities and locations.

Actual use of a registered identity requires its canonical context route or a valid entered route derived from it. Regular-Chain storage/import creates no competing registration; off-path use fails locally and does not poison the valid context. Competing independently committed context registrations invalidate shared authority without choosing an arrival-order winner. Failed import commits nothing. Inert aliases and Promise-only routes make no claim. Completed effects and exposed results are not revoked retrospectively, and no reverse alias/exposure history is maintained.

Registered mutable identities cannot escape through host arguments, native write values, controlled callbacks, or direct result extraction. Ordinary import neither grants authority nor downgrades a registered identity to observation-only. A parent external scope may operate on its fixed native descendants at their canonical locations; this grants no authority to hidden sibling aliases or managed storage. Hidden writable overlap between otherwise independent registered siblings violates the host contract.

Registering a nested resource also restricts its extraction: lookup of registered apis.db.config as data fails with ExternalCapabilityEscape, while a canonical lookup of config.timeout can return its value. An unregistered sibling object retains ordinary detached-snapshot behavior when supported. A snapshot containing a registered identity fails rather than copying that identity's interior; observation failure remains local. Managed-parent retention may carry an inert reference but grants no access authority.

The compiler format and entry lowering are specified in [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree); the tree representation and reservation rules are in [external context ordering](external-context-ordering.md).

### Identity and hidden state

- One mutable host resource must have one external identity. Do not expose the same resource through multiple wrappers or independently scheduled roots.
- Cascada does not scan external graphs for aliases or shared descendants. Hidden access to another mutable external owner's state, including read-only access through a wrapper, violates the single-owner ordering contract.
- Application code must not independently mutate or replace external state while Cascada may access it.
- Mutation-capable external APIs should be stable context resources, such as databases, web services, or LLM clients. Do not move, replace, or delete their original context binding after initialization.
- A retained reference to admitted managed data grants native methods no permission to inspect or mutate its raw storage. Managed data supplied to native code uses the normal explicit argument export boundary. Runtime property observation through such a reference uses logical snapshot reads, not arbitrary native dereferencing. Merely returning an inert managed reference is supported: result import reads its logical versions and may copy borrowed pending result containers to preserve source state. Cascada does not inspect closures, private fields, or unrelated native properties to find hidden references.
- A newly admitted identity read from observation-only external property state remains external even when it is a record or Array; existing admission and binding facts are never overwritten. Reading inside mutable external state instead produces a detached managed copy that preserves prototypes and Functions. Any copied class-like value must satisfy the managed-class state and method restrictions; native/internal-slot objects that cannot survive structural copying must be returned independently through a host method or remain observation-only external state. Structural copyability is a host requirement: the runtime does not infer hidden-state requirements from constructors and guarantees no diagnosis for violating it.
- Managed state may contain external identities, subject to the opaque-leaf managed-method rule above.

### External operations

- An external observation must not mutate its receiver.
- An external mutation may mutate only state owned by its selected registered external scope. A path crossing managed storage cannot regain native mutation authority at a later external descendant; writes, deletes, and mutating calls through that route fail without touching native state. A native receiver inside that scope uses its ordering; a managed ancestor or separately owned external sibling remains outside it. Exact external arguments grant no mutation authority and remain read-only; exported managed argument copies are independent host data.
- A property read crosses into Cascada through ordinary import when the external state is observation-only. A read inside mutable external state instead returns a detached managed snapshot. A property write crosses into external code and its value is exported first.
- The detached copy has the same visible graph-copy semantics as export: it preserves Arrays, aliases, cycles, prototypes, and Functions and may therefore expose supported managed methods without exposing the mutable external source. A Promise returned directly by the selected property may resolve before copying, but the copied graph itself must contain no Promise.
- An admitted managed source contributes its logical properties and Array structure, including ready placement-version values, rather than its physical storage. Every required nested value, placement presence, and structural fact must be ready when copied. An unresolved logical property, managed gate, undecided presence, or unresolved Array length produces `InvalidExternalSnapshot`, just like a nested host thenable; the snapshot does not subscribe, wait, or expose partial output. An undecided logical placement cannot be skipped because it has no physical slot or lies beyond the known minimum length. Ready logical length remains authoritative even above physical storage, preserving trailing holes. This ready-data restriction also applies when continuing a property path through an admitted managed source. Use ordinary managed operations when pending managed data must be consumed.
- A managed parent is retained through ordinary sharing and COW, without reading or copying its external interiors. Opaque external references remain inert without authority at the new location. Access through another location fails before host work, and export rejects a mutable external capability wherever it occurs in traversable data.
- Method results use ordinary import, not the mutable-property snapshot rule. A host method that returns an object to become managed must relinquish mutation of that identity or return a detached copy. Merely snapshotting a different observation does not make a managed source safe for native mutation.
- External Arrays and native collections use this host-method contract, not the controlled managed Array algorithms. Mutation mode must match the native method's effects. Inside mutable external state, a method returning its exact receiver is rejected, including native `reverse` or `sort` in mutation mode; completed effects remain and the failure poisons the selected scope. A shallow result such as `slice` over mutable object elements is not detached: use a host method that returns an independent graph, relinquish the returned storage, or read a property snapshot. Cascada does not insert automatic callback export or borrowed-result copying into arbitrary native methods. A genuinely observation-only external receiver may return itself unchanged; it remains read-only and gains no authority.
- Assignment and deletion are mutations even without `!`; their default mutation scope is the exact target placement. An explicit ancestor `!` broadens that scope. External scope selection uses the selected registered tree node; a mixed managed ancestor is invalid and becomes guarded poison before native work.
- Replacing `ctx.db` changes a managed placement even when its old value is external. Changing `ctx.db.name` is an external property operation when `ctx.db` is external.
- Native Array length assignment must preserve registered indexes, including when the selected mutation scope is an ancestor of the Array. A rejected truncation leaves native storage unchanged and poisons its selected scope; repair restores access. Ordinary managed index appends and length growth remain allowed, but an Array-wide bang such as push cannot cover registered mutable resources.
- A native setter must finish synchronously.
- All mutations inside one mutable external owner are exclusive across its entire native graph. Assigning resource.a = pendingValue reserves that owner before waiting for the value, finishes export and the native write, and only then releases the phase. A later write or read of resource.b waits even though b is unrelated. Consecutive observations after that mutation may overlap; the next mutation waits for all of them. No native property receives a runtime gate or Promise placeholder, and the ordinary assignment return still signals issuance rather than completion.
- Inside external state, intermediate path values must be ready native values. Cascada never awaits a Promise to continue a native property path or obtain a method receiver/callable. Only the final value read by lookup, or the direct result of an invoked method, may be a Promise; its result boundary consumes that Promise before import or snapshotting. A Promise nested inside the final snapshot graph remains invalid.
- Native property lookup, assignment, and deletion are supported under their ordinary authority and ordering. For external `x`, looking up `x.promiseProperty` may consume that final Promise, and `x.promiseProperty = value` or `delete x.promiseProperty` replaces or removes the property without reading or consuming its old value. Traversing `x.promiseProperty.y`, including assigning or deleting `y`, fails without subscribing to the intermediate Promise. Assignment exports the new value before the native write; it never installs a Cascada Promise version in external storage.
- An authorized external mutation may leave completed effects when its method, setter, or Proxy trap throws or rejects. Failure poisons the selected mutation scope; it does not roll back those effects. The managed-storage Proxy restriction does not apply inside an opaque external identity.
- External mutation authority is never transferred through lookup, assignment, an argument, export, storage, or return.

### Entry

Entry supports Cascada reference arguments and delayed control flow. It may select a mixed branch and grants no exception to mutation scope rules. Mutating managed entry gates its selected placement, using ordinary ancestor COW where necessary; entering a.x does not block a.y. It also reserves exclusive access to any external descendants. Managed read-only entry leases its captured value. Every read-only entry, including one rooted at an external scope, reserves observation access to covered external resources; other observations overlap and later mutations wait. Entry itself is not a rollback transaction: each contained managed mutation has its own baseline and earlier completed operations remain committed.

Entry preserves placement presence. A no-op callback on a missing record property or Array hole leaves it absent; an explicit undefined assignment creates a property. An out-of-range Array-index mutating entry protects the owning Array while the callback can change its length, so later length/whole-Array access and structural mutation wait. Installing entry protection itself never grows length. In-range elements and holes retain local protection; consumers that depend on presence use the completed placement state. Read-only entry creates neither a missing placement nor a structural mutation gate.

Entry may select a poisoned managed or external target so its callback can inspect, repair, or replace that target through ordinary permitted operations. Recovery state stays attached to the selected placement and transfers with the entered root; it is not attached to the Error. Poison on a strict ancestor prevents reaching the target. Read-only entry permits inspection but grants no repair or mutation permission.

Compiler selection chooses the deepest enclosing registered external scope for a native-property control-flow target. Managed and mixed targets remain at their requested paths. The runtime rejects explicit unregistered native-property entry with ordinary PropertyValidation poison, skips the callback, and follows the selected mutation/error rules; this is not fatal merely because compiler lowering produced it. Registered paths remain source-static.

Contained operations run through the entry's reservation view and cannot wait behind later outside work already waiting for that entry. Nested entries retain their own completion after parent callback closure. Closing the callback stops new issuance, not already-issued effects. Managed root publication is independent of external descendant completion, so ready managed siblings remain usable while a native child is pending. Reference arguments to Cascada functions use this same mechanism; host-native arguments retain their separate export contract.

### Repair

A scope's own poison blocks its descendants. Child poison contributes to an ancestor's subtree summary, blocking operations consuming that whole subtree but not healthy siblings. Contextual external Error queries inspect complete required metadata unions without reading native properties; queries at a managed guard stop at that guard. Store no duplicate ancestor-owned poison merely because a child failed.

Repair-only uses ordinary managed placement ordering and exclusive external reservations where needed. It clears selected managed scope poison to expose its preserved pre-operation value/version, and clears repairable poison in a covered external subtree without changing native state. Successful repair returns undefined and invokes no native method or external-resource read/write. A healthy or absent managed target requires no managed change; an ordinary Error without a retained baseline returns that exact Error unchanged and blocks repair-and-call. Strict-ancestor own poison and permanent binding conflicts cannot be cleared; derived external summaries do not block repairing their child. It does not traverse or erase ordinary Error data or independent earlier managed failures within the retained baseline.

Managed repair restores the baseline and removes its poison in one placement transition. Required fallible preparation/publication precedes committing repair; supported failure leaves the existing recovery state and covered external poison intact. Complete the managed and external metadata updates before dependent access resumes. Invalid external repair authority uses ExternalLocationConflict, not a separate repair-failure category.

Repair-and-call performs the same clearing first, then ordinary call preparation and invocation under the same required managed/external ordering. A managed call captures its repaired baseline; failure cannot restore deliberately cleared poison. For external apis, apis!!.reset() clears child scope Errors before reset runs; a preparation error or thrown/rejected/direct method Error poisons again with new failure. Outside work cannot observe intermediate clearing under that protection. Entry may be mixed, but repair-and-call still obeys ordinary mutation-scope restrictions.

Repair does not expose the failed managed working receiver: that state was discarded when its operation failed. Captured earlier values and returned Errors remain unchanged. Final replacement/deletion of a replaceable managed location can discard scope poison and its baseline; fixed resource namespaces cannot be replaced or deleted. Repair creates no authority, changes no registered identity or tree structure, and reverses no external effects. Cascada code may modify the restored state afterward; higher-level guard/recover owns rollback across multiple operations.

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
