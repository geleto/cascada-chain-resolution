# Standard Method `run`

## Status

**Implemented.** This is the restricted invocation layer for standard String and Array operations and trusted read-only methods. It does not implement general side-effecting class methods.

## Contract

```js
run(chain, path, method, mutateArray, ...arguments)
```

`method` must be a string and `mutateArray` must be exactly `true` or `false`. Both are supplied before the receiver or any argument settles. A non-string method, invalid Boolean, `constructor`, or mutation request outside the intercepted set returns a language Error before any path walk or gate.

`path` is the complete receiver path and distinguishes a missing final property from one containing `undefined`. For mutation, its last segment is the property transformed and replaced; `method` is only the operation applied to that property's value. An empty path targets the Chain root property. A receiver may be a primitive string, logical Array, or tracked object with a trusted read-only executable surface. Tracked objects are plain records, null-prototype records, and registered data-class instances. Opaque class and native internal-slot values may remain in the graph but cannot be receivers. Native Arrays, native Arrays carrying `META.arrayView`, and internally branded `ArrayView` instances are logical Arrays.

## Dispatch

The intercepted Array mutators are:

```text
copyWithin fill pop push reverse shift sort splice unshift
```

| `mutateArray` | Resolved call | Behavior |
| --- | --- | --- |
| `false` | Logical Array mutator | Leave the receiver unchanged and return a distinct transformed logical Array. |
| `false` | Any other supported method | Invoke it as a trusted observation and return its result. |
| `true` | Logical Array mutator | Mutate or publish a new receiver and return the JavaScript mutator result. |
| `true` | Non-Array receiver | Publish and return a language Error without invocation. |

A logical Array mutator is selected intrinsically by name even when a receiver property shadows that name. The same-named method on a non-Array object remains an ordinary observation.

Method lookup for a logical Array uses the backing Array, so a view and its source identity select the same executable surface. The materialized receiver passed to an ordinary selected method is a temporary native shape that is never published, ref-indexed, or treated as another language owner.

Ordinary lookup preserves JavaScript shadowing. An own enumerable language property shadows the prototype but is never an executable method. Otherwise normal property access selects a callable own non-enumerable or prototype value, including one supplied by a getter. Lookup and the selected method must be trusted read-only and must not retain inputs or cause external side effects; other side-effecting methods are unsupported.

String methods use the ordinary observation path. Their dispatch protocols, such as `Symbol.match`, `Symbol.replace`, and `Symbol.split`, and callable arguments such as replacement callbacks are part of the same trusted read-only call and are subject to the ordinary exported-argument and result-admission boundaries. Controlled Array intrinsics support the methods declared by the Array method table; `sort` and `toSorted` additionally support the comparator contract below. Array callback methods such as `map`, `filter`, `reduce`, and `forEach` are deferred. Array `keys`, `values`, and `entries` are outside the controlled method table; direct Array iteration and spread use the runtime iterator path.

Controlled Array dispatch assumes the relevant Array prototype entries are native.

An observation never publishes its receiver. An intercepted mutator run as an observation returns a distinct post-mutation logical Array even for a no-op.

## Language Integration

Lowering captures every argument position before issuing `run`, preserves omission and arity, and passes the captured logical values unchanged. After dispatch, `run` exports only arguments that will be consumed by native code. Argument export accepts an already-evaluated value and returns either its ready host snapshot or a Promise for that snapshot; it does not require the value to originate from a Chain. Unlike branch export, it preserves Errors nested in Array elements and object properties. A sort comparator occupies a separate executable slot and is passed directly or as a control Promise without import, export, result admission, or storage in the Chain.

| Boundary | Export |
| --- | --- |
| Delegated Array argument | `run` exports the positions marked by the Array method table; native code receives the resolved result unchanged. |
| Logical Array receiver, element, search value, or assignment payload | None. The controlled wrapper preserves logical identity and Promise placement after top-level argument Error poisoning. |
| `sort` or `toSorted` comparator | None. The callable remains outside the graph and receives logical element values under the trusted comparator contract. |
| Ordinary observation, including a String method | Resolve the receiver through its path; export and resolve every argument before invocation. |

Controlled Array operations never export their logical receiver or elements merely to invoke an intrinsic. An ordinary selected method receives the resolved receiver directly as `this`; only its arguments cross `run`'s value-export boundary. A logical Array view is shallow-materialized first because its internal representation is not a native indexed receiver. Method lookup occurs before argument readiness.

Non-Error Array payloads and identity-bearing values keep their logical identity. This includes `push` and `unshift` values, the `fill` value, `splice` and `toSpliced` insertions, the `with` value, search values, and values retained by `concat` or `flat`. A controlled structural intrinsic may receive them directly; its wrapper prepares ownership, mirrors, and bookkeeping.

All method arguments use Cascada Error poisoning: a direct top-level Error, or a Promise argument that must resolve and produces an Error, becomes the call result and prevents invocation. Poisoning is shallow; Errors nested in Array elements or object properties remain data. For an ordinary trusted native observation, each argument export may return directly or as a Promise. If every argument is ready, invocation is synchronous. Otherwise `run` coordinates only those results through the canonical Promise helpers.

Array `toLocaleString` is deferred because it invokes executable element methods. A direct or settled method result is admitted before entering the graph: opaque and primitive values pass through, while tracked language-data objects receive normal ownership preparation and remain lazily ref-indexed. Controlled Array results are runtime-owned. A tracked result from any ordinary trusted method, including a String method or Array override, is imported because the call may return externally retained data. A returned method Promise uses the canonical helpers, converts rejection to a language Error, and applies the same admission rule to fulfillment.

## Cascada scalar conversion

Native methods perform their own JavaScript coercion after exported arguments resolve or controlled Array preparation completes. The runtime performs scalar conversion itself only when a specialized logical wrapper consumes the converted value, notably Array search and `flat` indexes, Array length assignment, default sort keys, and Array text conversion. A property version inspected by such logical conversion resolves through the runtime helpers; unrelated properties and nested Promises are not visited. A language Error reached on the inspected path becomes the operation result rather than being stringified or numerically converted.

Implicit conversion of tracked language data is intrinsic and never invokes object protocols. Logical Arrays use recursive intrinsic joining; ordinary records and registered data-class instances use Object-like default conversion. Null-prototype records and opaque objects cannot be converted. Properties named `Symbol.toPrimitive`, `toString`, `valueOf`, or `join` remain data and do not affect implicit conversion. Values already exported to native code follow native JavaScript conversion instead.

Default `sort` and `toSorted` use the scalar conversion described under Sort comparison. `join` and intrinsic Array `toString` build their text through the same logical conversion.

## Sort comparison

Without a comparator, each non-`undefined` value is converted to its default comparison string and those strings are ordered lexicographically by UTF-16 code units. These strings are internal preparation, not language-visible keys. Preparing each once is equivalent because tracked-data conversion has no executable hooks. Explicit `undefined` follows all string-compared values without conversion, and `sort` retains holes after `undefined`.

The comparator argument may be a direct callable, `undefined`, or a Promise resolving to either. This includes a Promise produced when control flow selects between comparator bindings, such as assigning `compGreater` in one branch and `compLessOrEqual` in another. The callable bindings and their merged Promise remain executable control values; fulfillment is consumed by the comparator slot and never admitted into the language graph. A non-callable non-`undefined` value or rejection becomes a language Error. Comparator readiness and validation precede element collection as in JavaScript.

A comparator, including any coercion behavior exposed by its result, is trusted read-only, side-effect-free, and non-retaining. It is invoked with `undefined` as the `this` argument and receives two resolved logical element values; tracked identity is preserved. Holes and `undefined` are ordered by the wrapper and are not passed to it. A language Error or Promise result becomes the operation Error; every other synchronous result is returned to native sort for JavaScript `ToNumber` conversion, where `NaN` means equality.

After comparator and element preparation, the comparator overload invokes native stable `toSorted` on runtime records and applies its permutation to the logical values. A promised comparator binding may gate a mutating sort while the callable is selected, but comparison itself never waits. The result and comparison call sequence therefore follow the JavaScript engine for a well-formed comparator.

## Argument readiness

An assignment-style Array payload is neither exported nor awaited after the ready argument list passes Error poisoning. A tracked payload gains another owner and becomes shared. A Promise payload is installed immediately as a Promise-valued property, with one fresh property-version mirror per destination; each destination marks the value it resolves to shared at its own FIFO position, so one Promise reaching several placements never leaves them aliasing an unprotected value. It is data, not operation readiness, and does not create an argument wrapper or mutation gate; if it later rejects, the resulting Error is an Array element rather than retroactive operation failure.

The search value for `includes`, `indexOf`, or `lastIndexOf` is also not exported, but a top-level Promise must resolve before comparison and Error-poisons the call if it rejects. A `concat` item resolves only when its top-level value is needed to decide whether to spread a logical Array and likewise Error-poisons the call; non-spread items and spread elements remain logical values. Comparator readiness follows Sort comparison. Native-bound argument export and logical preparation scan their inputs synchronously and create no Promise wrapper when everything is ready.

## Array element Promises

Array wrappers use logical properties and never expose ArrayView backing. They resolve direct Promise-valued indexed properties only when the JavaScript operation needs their values:

| Operations | Element handling |
| --- | --- |
| `at` | Resolve only the selected property version. |
| `includes`, `indexOf`, `lastIndexOf` | Use the search-specific rules below. |
| `concat` | Do not resolve receiver elements; resolve an item only to decide whether it is a logical Array to spread. |
| `flat` | Resolve only a candidate whose value must be tested for recursive flattening. Retained values at the depth limit are not resolved. |
| `sort`, `toSorted` | Resolve every present top-level element participating in ordering. Default comparison then prepares strings; a supplied comparator receives the logical values. |
| `join`, intrinsic Array `toString` | Resolve each indexed value the text result inspects and any further Promise reached by its scalar conversion. |
| `push`, `unshift`, `fill`, `splice`, `toSpliced`, `reverse`, `toReversed`, `copyWithin`, `slice`, `with` | Do not resolve elements merely to retain, insert, replace, move, or copy them. |
| `pop`, `shift` | Contract the receiver without waiting; resolve a removed Promise only for the independent method result. |

Moving a Promise-valued property never moves its mirror. The destination receives a fresh mirror at this operation's program position, while the old mirror detaches or remains with an unchanged source identity. Copying one Promise into several properties creates one mirror per destination. Structure-only operations do not inspect nested Promises. Sort and text conversion continue only into logical values that scalar conversion actually inspects.

`at` returns the selected logical value and preserves tracked identity. A pending selected element produces only the result Promise needed to sample that captured property version.

`sort` and `toSorted` retain the logical values and follow Sort comparison. `sort` leaves holes after explicit `undefined`; `toSorted` follows its standard read-through-holes result. Intrinsic Array `toString` uses intrinsic logical joining. Non-index string properties are outside the Cascada Array surface.

### Identity-sensitive searches

`includes`, `indexOf`, and `lastIndexOf` never export Array elements. `includes` uses SameValueZero and treats holes as `undefined`; `indexOf` and `lastIndexOf` use strict equality and skip holes. Length capture, `fromIndex`, direction, and early termination match JavaScript. Tracked values compare by current identity; a copy-on-write version differs from its source, and structural comparison is never used. Error elements are ordinary comparable values.

`indexOf` and `lastIndexOf` traverse in search order. At a pending element they capture and resolve that property version, compare it, and continue only after a miss. Promise elements beyond the first match are never registered.

`includes` first compares every available non-Promise value. If none matches, it registers all captured Promise candidates in logical order and compares them as they resolve. It settles on the first match and makes remaining registrations cleanup-only; it returns `false` only after every candidate misses. An available match or absence of Promise candidates returns synchronously.

## Path and operation readiness

`mutateArray` selects `walkMutationPath` or `walkObservationPath` when the call is issued. `walkObservationPath` resolves the complete receiver path, including a Promise-valued final receiver. `walkMutationPath` resolves only through the receiver's owning parent so the terminal can gate a Promise-valued final receiver before waiting.

A path Promise is handled entirely by the selected walker. If post-target work is ready when its continuation reaches the target, the operation completes synchronously inside that continuation and the walker-produced Promise carries the result. Path delay alone creates no receiver gate or additional wrapper.

After an observation target is reached, `run` starts argument preparation. A direct operation returns directly without lease bookkeeping. If an operation on a tracked receiver remains pending on arguments, Array elements, conversion, or an asynchronous method result, it holds one read lease until result preparation completes. The lease protects the resolved receiver from later in-place mutation. Immutable String receivers and materialized temporary views need no lease.

`run` in mutation mode calls `walkMutationPath` directly. Its terminal callback passes the reached property to `transformProperty`, which captures that property version, starts preparation of every required argument, and invokes the operation callback with the resolved receiver, prepared arguments, and copy-on-write context. The operation callback contains no parent, key, mirror, gate, publication, or path-walking logic.

Ready work transforms and publishes synchronously, even when an earlier path segment delayed the walk. If the final receiver or required post-target preparation is pending, `transformProperty` replaces the receiver with an assigned-Promise gate before returning and exposes a separate result Promise. Receiver and argument readiness begin together. A Promise-valued receiver is sampled from its captured live or detached mirror after earlier FIFO continuations update that version; raw settlement is never consumed.

Once preparation completes, the callback performs one synchronous transition. `transformProperty` publishes the receiver before its independent result, applying the normal assignment, import, mirror, and copy-on-write rules. If the receiver property was superseded, its detached gate mirror no longer publishes there, but the result Promise still completes. An assignment-style payload Promise is data rather than readiness. A Promise removed by `pop` or `shift` may delay only the independent method result after the synchronous receiver transition.

All registration uses canonical Promise helpers. Raw `.then`, `async`/`await`, queueing, or a per-consumer proxy Promise must not split one source's FIFO batch.

## Array mutation and representation

While traversing to the receiver's owning parent, `walkMutationPath` calls `metadata.requiresCopyOnWrite(value)` on each path object. The first `true` starts path copy-on-write through the owning parent.

Observation always preserves the receiver. Mutation preserves it when `attachmentRoot` is defined or `metadata.requiresCopyOnWrite(receiver)` is true. `attachmentRoot` is the first copied node retained by the mutation walk; its presence means the old world still retains the receiver. `requiresCopyOnWrite` decides whether the current logical version must be preserved; it does not perform copying.

If preservation is unnecessary, a supported native representation is updated in place. Eligible endpoint mutation derives an `ArrayView` while preserving the current receiver. Numeric `slice` derives a bounds-only view. Eligible `concat` extends only the receiver's hidden backing and returns a longer view; it does not mutate an argument backing. Otherwise the active logical Array is copied or materialized into an owned native Array and the logical operation is applied there. A copying mutation may write the final shape back to an eligible owned native receiver to preserve its identity; COW publishes the new representation.

`push`, `pop`, `shift`, and `unshift` use [`array-view.md`](array-view.md) when endpoint sharing is eligible. Each unchanged Promise property receives a result-view mirror forked at the derivation's FIFO position even though the views share its physical backing slot. Otherwise the native algorithm operates on a sparse property-origin remap. Copying operations initialize its present origins because the result retains them all; in-place mutation obtains an origin only when native code reads that index. Writing an origin records its destination `newIndex` as a move; writing a raw argument records an addition; indexed deletion and length writes remain deletion and length operations. Before replay changes the receiver, it captures the value, Promise mirror, and cycle cut of every moved origin. Replay then uses the ordinary assignment, deletion, and Array-length mutations in native order, preserving partial-failure behavior. A removed native result is materialized before replay so it retains its original property version. Default and comparator `sort` produce the same remap through native stable `toSorted`. An owned mutation receiver receives the completed shape back under the copying rule above.

### Results

| Methods | Mutation result | Observation result |
| --- | --- | --- |
| `copyWithin`, `fill`, `reverse`, `sort` | Published receiver | Transformed Array |
| `push`, `unshift` | New logical length | Transformed Array |
| `pop`, `shift` | Removed value or `undefined` | Shortened Array |
| `splice` | Array of removed property versions | Post-splice Array |

Receiver publication is never inferred from the method result. Every tracked result receives normal ownership preparation. A receiver-returning mutation result aliases the published path and makes that identity shared; a wholly removed or newly created result may transfer when it has no other owner.

### Mutation bookkeeping

An unpublished working Array may be completed and indexed once before publication or return. An existing ref-indexed logical Array instead applies the ordered remap, assignment, deletion, and length operations without a before/after reconciler. Every completed placement is finalized before a partial-failure Error is returned. An entering edge is prepared and indexed before its contribution is added. A leaving edge removes its reverse-parent multiplicity and Promise/Error/cycle-cut totals. A replacement applies only the old-to-new edge delta.

| Operation | Bookkeeping |
| --- | --- |
| `delete array[index]`, `pop` | Remove the deleted or removed element's contribution when the property exists. |
| `push` | Add each appended element's contribution. |
| `shift` | Remove the first contribution; retained remapping changes no multiplicity or aggregate count. |
| `unshift` | Add inserted contributions; retained remapping changes no multiplicity or aggregate count. |
| `splice` | Remove deleted and add inserted contributions; retained remapping changes no multiplicity or aggregate count. |
| `fill`, `copyWithin` | Apply an edge replacement at each changed destination. |
| `reverse`, `sort` | Permutation changes no multiplicity or aggregate count after any required Promise resolutions. |

Holes have no contribution. Placement-specific state, including cycle cuts and Promise mirrors, is cleared, retained, or recreated for the corresponding logical property even when aggregate counts do not change. ArrayView endpoint contraction removes the changing identity's logical edge even when another view retains the physical element. Storage and bookkeeping steps form one synchronous method-specific transition, so every completed step remains accounted for after a partial failure.

## `length`

Array `length` is a visible, non-enumerable, non-configurable intrinsic property of every logical Array. The mutation walk classifies a terminal property before treating it as a graph edge: ordinary properties target that edge, while intrinsic `length` targets the receiver's enclosing placement. `transformProperty` gates that placement when conversion waits. The payload is converted only after the receiver is known to be a logical Array; another object's `length` remains an ordinary property and may hold a Promise. Setting Array length follows `ArraySetLength`. Each successfully truncated property detaches its mirror and removes its edge contribution and placement-specific state. Shared, imported, or read-protected Arrays copy before the change. ArrayView rules are in [`array-view.md`](array-view.md).

String `length` is a visible, non-enumerable, non-configurable, read-only intrinsic property. Its read resolves only the receiver path. Assignment or deletion returns a language Error without changing the receiver; deleting Array `length` does the same.

A `run` receiver path ending at either intrinsic `length` selects a number, never an Array. Mutation mode therefore returns its validation Error directly, because intrinsic length is not a graph placement that can hold that Error.

## Errors

A broken observation path returns its path-access Error. A broken mutation path installs that Error under the ordinary mutation rule and returns it. An observation with a missing final receiver, final Error, Error-poisoned argument, unsupported receiver, method, overload, or native input returns a language Error without invocation. Errors contained in receiver elements or properties remain data unless the selected operation consumes and converts that value. An Array mutation on a missing or non-Array final receiver installs its validation Error at that path and returns the same Error.

A synchronous invoked-method throw and a returned method-Promise rejection become language Error results. Unlimited `flat` of a logical Array cycle has no finite result and returns a language RangeError corresponding to native stack overflow. Another mutation failure publishes the unchanged receiver or any partial mutation whose completed edge transitions are already accounted for, then returns the operation Error. An observational mutator discards its private working copy.

A kernel invariant, bookkeeping failure, or trusted-call contract violation is fatal. An installed receiver or result gate remains unresolved after fatal abort. A partial native mutation converts only the descriptor failures raised by the language-property assertions; every other throw during replay stays fatal.

## Implementation boundary

`src/run.js` owns routing, observation coordination, mutation policy, and result admission. `src/invocation.js` owns safe descriptor lookup, native calls, and ordinary exported-argument invocation, including String methods. `src/mutations.js` owns path copying, receiver replacement, Promise gates, and `transformProperty`; `src/language-properties.js` owns terminal-property classification, descriptors, validation, and physical language-property access. `src/property-versions.js` owns exact property versions, placement, publication, validated deletion, and Array-length commits. `src/array-methods.js` declares and implements supported Array methods, while `src/array-invocation.js` interprets those declarations. `src/array-remap.js` owns property-origin remaps, native-mutation tracing, application, and materialization. `src/observations.js` owns path export and native-argument export. `src/resolution.js` owns canonical Promise resolution, operation-result coordination, and Error poisoning. `src/language-conversion.js` owns Promise-aware scalar conversion required by logical wrappers. `src/array-view.js` owns ArrayView representation, backing preflight, endpoint transitions, and bounds. `src/refcounts.js` owns logical-edge accounting, and `src/meta.js` owns reusable read leases.

Logical-Array and intrinsic-`length` access is routed through `src/language-properties.js` for every graph operation. Traversal recognizes String `length` without treating a primitive String as a tracked object; assignment and deletion reject it without replacing the String receiver. `src/index.js` exports `run`; ArrayView and derived-assignment helpers remain internal. Array callback methods other than sort comparison, Map/Set support, and proxy-backed mutating class methods are outside this step.

## Verification

Run all coverage in inline-Symbol and WeakMap metadata modes. Do not duplicate the JavaScript engine's intrinsic method-algorithm tests; cover the Cascada boundary:

- validation before walking, intrinsic shadowing, ordinary overrides, rejected constructors, String protocols and callbacks, deferred Array callbacks, and opaque results;
- direct and delayed paths, zero or multiple readiness Promises, concurrent receiver and argument preparation, assignment-style Promise payloads without waiting, operation leases, gates before returning from required waits, receiver-before-result settlement, supersession, and gate-free ready transitions;
- argument export boundaries, logical preparation, direct ordinary receivers, result admission, and no raw ArrayView backing exposure;
- Cascada scalar conversion of primitives, logical Arrays, supported records and instances, null prototypes, opaque objects, direct and nested Promise frontiers, and Errors, including ignoring protocol-named data properties;
- direct, invalid, promised, throwing, and Promise-returning sort comparators, including rejection of asynchronous comparison, argument identity, result coercion, stable ties, `undefined`, and holes;
- native structural delegation through property-origin remaps, including lazy in-place reads, duplicate Promise identities, argument omission, Promise mirror recreation, aliases, Errors, and copy-on-write identities;
- Promise-specific `at`, search, `flat`, text conversion, and sort timing, including early termination and concurrent independent preparation;
- mutation and observational mutator calls across owned, shared, imported, protected, native, and viewed receivers, including partial failures and edge bookkeeping; and
- Array and String length reads, growth, truncation, invalid values, partial truncation failure, mirror detachment, attached views, and logical iteration; and
- bounded seeded differential comparisons with native Array, String, indexed-property, deletion, and length behavior across direct, Promise, copy-on-write, bounded or restricted ArrayView, attached-version, and mixed FIFO modes.
