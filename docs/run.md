# Standard Method `run`

## Status

**Planned.** This is the restricted invocation layer for standard String and Array operations and trusted read-only methods. It does not put functions in the language graph or implement general side-effecting class methods.

## Contract

```js
run(chain, path, method, mutateArray, ...arguments)
```

`method` must be a string and `mutateArray` must be exactly `true` or `false`. Both are supplied by lowering before the receiver or any argument settles. A non-string method, invalid Boolean, `constructor`, or marked method outside the intercepted set returns a language Error before any path walk or gate.

Cascada's `!` operator is extended from context-object effects to variable Array mutation:

```js
query.results!.push(1)
```

The marked form passes `true`; the unmarked form passes `false`. Existing context-object `!` behavior remains separate.

`path` identifies the receiver and distinguishes a missing final property from one containing `undefined`. A receiver may be a primitive string, logical Array, or supported tracked object with a trusted read-only executable surface. Supported tracked objects are plain records, null-prototype records with a host descriptor, and certified property-state class instances; opaque external classes and unsupported native internal-slot objects are not admitted. Native Arrays, native Arrays carrying `META.arrayView`, and internally branded `ArrayView` instances are logical Arrays.

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

A logical Array mutator is selected intrinsically by name even when a receiver property shadows that name. The same-named method on a non-Array object remains an ordinary unmarked call.

Ordinary lookup preserves JavaScript shadowing. An own enumerable language property shadows the prototype but is never an executable method. Otherwise a callable own non-enumerable property, prototype method, or compiler or host descriptor may be selected outside the language graph. The selected method must be trusted read-only and must not retain inputs or cause external side effects; other side-effecting methods are unsupported.

Standard String and Array methods are supported when their selected overload needs no caller-provided callback, replacement function, or executable protocol hook. `sort` and `toSorted` additionally support the comparator contract below. Other callback methods such as `map`, `filter`, `reduce`, and `forEach` are deferred. Calls that return native iterator objects, including `keys`, `values`, `entries`, and `matchAll`, are unsupported because those stateful internal-slot objects are not language data. Direct iteration and spread use the runtime iterator path rather than `run`.

RegExp and other unsupported internal-slot or executable-protocol arguments are rejected from their original captured values before preparation. Primitive string patterns remain supported. An ordinary call never publishes its receiver. An unmarked intercepted mutator returns a distinct post-mutation logical Array even for a no-op.

## Language Integration

Lowering captures every argument position before issuing `run` and preserves omission and arity. A sort comparator occupies a separate executable slot: lowering passes its direct callable or control Promise to `run` without import, export, result admission, or storage in the Chain. A standard method uses Cascada-aware logical access and coercion whenever that avoids exposing tracked data or resolving an irrelevant subtree. The surrounding integration owns export, but standard Array and String methods do not need it:

| Boundary | Export |
| --- | --- |
| Standard Array or String operation | None. Logical algorithms prepare primitives and small runtime-owned native inputs. A structural Array intrinsic may retain or relocate Cascada values directly under its runtime wrapper. |
| `sort` or `toSorted` comparator | None. The callable remains outside the graph and receives logical element values under the trusted comparator contract. |
| Other trusted native observation | Export the tracked receiver and every non-primitive argument. |

No standard Array or String operation exports its receiver, elements, or arguments. A full logical receiver snapshot is needed only when an ordinary selected method or non-intrinsic override receives it as `this`; that receiver and its exported arguments form one snapshot so aliases between them are preserved. Method lookup occurs before export, and a method that requires the original prototype, hidden state, or unexported aliases is not compatible with this surface.

Array payloads and identity-bearing values keep their logical identity. This includes `push` and `unshift` values, the `fill` value, `splice` and `toSpliced` insertions, the `with` value, search values, and values retained by `concat` or `flat`. A controlled structural intrinsic may receive them directly; its wrapper prepares ownership, mirrors, and bookkeeping. RegExp, unsupported callbacks, and other executable-protocol or internal-slot arguments are rejected from the captured values before preparation.

For an ordinary trusted native observation, export may return directly or wait on a Promise. If every required export is direct, it adds no wrapper. Otherwise `run` coordinates only those results through the canonical Promise helpers; it does not implement export. An export Error is the operation result.

`toLocaleString` is deferred because it invokes executable element methods. A direct or settled method result is admitted before entering the graph: primitives, Errors, and supported language-data objects receive normal ownership and indexing, while a callable or unsupported native internal-slot object becomes a language Error. A returned method Promise uses the canonical helpers, converts rejection to a language Error, and applies the same admission rule to fulfillment.

## Cascada scalar coercion

Standard Array and String methods implement the JavaScript scalar coercions they require against logical Cascada values, including `ToString`, `ToNumber`, `ToIntegerOrInfinity`, `ToLength`, and `ToUint32`. A top-level Promise and any later property version actually inspected by coercion resolve through the runtime helpers; unrelated properties and nested Promises are not visited. A language Error reached on the inspected coercion path becomes the operation result rather than being stringified or numerically converted.

The supported object path reproduces the data-only behavior of logical Arrays and the known intrinsic coercion behavior of supported records and certified instances. Own language properties retain JavaScript shadowing. A callable `Symbol.toPrimitive`, `toString`, `valueOf`, or other executable coercion hook is outside this step and returns a language Error rather than being invoked. Null-prototype and shadowed objects retain the corresponding JavaScript success or conversion failure.

Default `sort` and `toSorted` use the scalar conversion described under Sort comparison. `join` and intrinsic Array `toString` build their text through the same logical conversion. Other String intrinsics receive a primitive receiver and primitive scalar arguments.

Locale-sensitive String methods use dedicated logical preparation rather than export. Locale-list length and present elements, and the `localeMatcher`, `usage`, `sensitivity`, `ignorePunctuation`, `collation`, `numeric`, and `caseFirst` option properties, are read and coerced only when the selected intrinsic uses them. The resulting primitives are placed in a small metadata-free Array or record for native locale processing. Other properties and nested Promises are not inspected.

## Sort comparison

Without a comparator, each non-`undefined` value is converted to its default comparison string and those strings are ordered lexicographically by UTF-16 code units. These strings are internal preparation, not language-visible keys. Preparing each once is equivalent on the supported surface because executable coercion hooks are excluded. Explicit `undefined` follows all string-compared values without conversion, and `sort` retains holes after `undefined`.

The comparator argument may be a direct callable, `undefined`, or a Promise resolving to either. This includes a Promise produced when control flow selects between comparator bindings, such as assigning `compGreater` in one branch and `compLessOrEqual` in another. The callable bindings and their merged Promise remain executable control values; fulfillment is consumed by the comparator slot and never admitted into the language graph. A non-callable non-`undefined` value or rejection becomes a language Error. Comparator readiness and validation precede element collection as in JavaScript.

A comparator is trusted read-only, side-effect-free, and non-retaining. It is invoked with `undefined` as the `this` argument and receives two resolved logical element values; tracked identity is preserved. Holes and `undefined` are ordered by the runtime and are not passed to it. Its direct or Promise result is resolved and passed through Cascada `ToNumber`; `NaN` means equality. A thrown exception, rejection, or language Error becomes the operation Error. Comparator selection and result Promises use `onInitialPromiseResolve`, whose rejection conversion is the required language behavior; they do not use `runOperationCallback`, whose rejection contract is fatal.

The comparator overload uses a Promise-aware stable merge sort. Each comparison runs only when the preceding comparison needed by that algorithm has completed, and every wait uses the canonical Promise helpers. A fully direct comparator keeps the operation synchronous. A marked sort installs its receiver gate before the first comparator wait and writes the final permutation only after sorting completes; an unmarked sort or `toSorted` holds its read lease. The result matches JavaScript for a well-formed comparator; as with native JavaScript, no portable result is promised for an inconsistent comparator, and the engine-specific comparison call sequence is not reproduced.

## Argument readiness

An assignment-style Array payload is neither exported nor awaited. A tracked payload gains another owner and is marked shared. A Promise payload is installed immediately as a Promise-valued property, with one fresh property-version mirror per destination. It is data, not operation readiness, and does not create an argument wrapper or mutation gate.

The search value for `includes`, `indexOf`, or `lastIndexOf` is also not exported, but a top-level Promise must resolve before comparison. A `concat` item resolves only when its top-level value is needed to decide whether to spread a logical Array; non-spread items and spread elements remain logical values. Comparator readiness follows Sort comparison. Scalar coercion, locale preparation, and an ordinary native observation's export add waits only for the values they inspect. The runtime scans the required readiness results synchronously and creates no Promise wrapper when they are all ready.

## Array element Promises

Logical Array algorithms use logical properties and never expose ArrayView backing. They resolve direct Promise-valued indexed properties only when the JavaScript operation needs their values:

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

Moving a Promise-valued property never moves its mirror. The destination receives a fresh mirror at this operation's program position, while the old mirror detaches or remains with an unchanged source identity. Copying one Promise into several properties creates one mirror per destination. Structure-only operations do not inspect nested Promises. Sort and text conversion continue only into logical values that scalar coercion actually inspects.

`at` returns the selected logical value and preserves tracked identity. A pending selected element produces only the result Promise needed to sample that captured property version.

`sort` and `toSorted` retain the logical values and follow Sort comparison. `sort` leaves holes after explicit `undefined`; `toSorted` follows its standard read-through-holes result. Intrinsic Array `toString` first applies JavaScript's `join` lookup: the intrinsic `join` path uses the indexed text-conversion rule, a non-callable language-property shadow uses the Object-style fallback without inspecting elements, and an executable override is unsupported. Pending or erroneous non-index properties are otherwise irrelevant.

### Identity-sensitive searches

`includes`, `indexOf`, and `lastIndexOf` never export Array elements. `includes` uses SameValueZero and treats holes as `undefined`; `indexOf` and `lastIndexOf` use strict equality and skip holes. Length capture, `fromIndex`, direction, and early termination match JavaScript. Tracked values compare by current identity; a copy-on-write version differs from its source, and structural comparison is never used. Error elements are ordinary comparable values.

`indexOf` and `lastIndexOf` traverse in search order. At a pending element they capture and resolve that property version, compare it, and continue only after a miss. Promise elements beyond the first match are never registered.

`includes` first compares every available non-Promise value. If none matches, it registers all captured Promise candidates in logical order and compares them as they resolve. It settles on the first match and makes remaining registrations cleanup-only; it returns `false` only after every candidate misses. An available match or absence of Promise candidates returns synchronously.

## Path and operation readiness

`mutateArray` selects `walkMutationPath` or `walkObservationPath` when the call is issued. `walkObservationPath` resolves the complete receiver path, including a Promise-valued final receiver. `walkMutationPath` resolves only through the receiver's owning parent so the terminal can gate a Promise-valued final receiver before waiting.

A path Promise is handled entirely by the selected walker. If post-target work is ready when its continuation reaches the target, the operation completes synchronously inside that continuation and the walker-produced Promise carries the result. Path delay alone creates no receiver gate or additional wrapper.

After an observed target is reached, `run` starts receiver preparation and coordinates it with the argument-preparation results supplied by the surrounding runtime. A direct operation returns directly; pending preparation returns one runtime-helper Promise, which a delayed walker assimilates. A logical receiver retained across post-target waiting holds one read lease until its captured work and result preparation complete. The lease protects that logical identity from later in-place mutation but does not expose or lock ArrayView storage. Exported snapshots need no lease after capture.

After a mutation terminal is reached, ready work mutates synchronously without a gate even when an earlier path segment delayed the walk. If the final receiver or required post-target preparation is pending, the terminal replaces the receiver with an assigned-Promise gate before waiting and returns a separate result Promise. An assignment-style payload Promise is not such a wait. A Promise removed by `pop` or `shift` may make the method result pending after the synchronous receiver transition; it does not require a receiver gate.

For a Promise-valued final receiver, `run` obtains its mirror before replacement. Installing the receiver gate detaches that mirror, and one runtime-helper continuation samples `detachedValue` after earlier FIFO continuations update it. The raw receiver Promise's settlement is never consumed.

Once required preparation completes, the mutation handler performs one synchronous transition, resolving an installed receiver gate before its independent result Promise. If the receiver property was superseded, its detached gate mirror no longer publishes there, but the result Promise still completes.

All registration uses canonical Promise helpers. Raw `.then`, `async`/`await`, queueing, or a per-consumer proxy Promise must not split one source's FIFO batch.

## Array mutation and representation

While traversing to the receiver's owning parent, `walkMutationPath` calls `metadata.requiresCopyOnWrite(value)` on each path object. The first `true` starts path copy-on-write through the owning parent.

At the receiver:

```js
const preserveReceiver =
    !mutateArray ||
    attachmentPath !== undefined ||
    metadata.requiresCopyOnWrite(receiver)
```

`attachmentPath` is the mutation walk's COW record; a defined value means the old world still retains the receiver. `requiresCopyOnWrite` is the predicate that decides whether the current logical version must be preserved, not a copying action itself.

If preservation is unnecessary, a supported native representation is updated in place. If preservation is required and an endpoint operation can derive an `ArrayView`, the derived view changes while the current receiver remains unchanged. Otherwise the active logical Array is copied or materialized into an owned native Array and the logical operation is applied there. A marked copying implementation may write the final shape back to an eligible owned native receiver to preserve its identity; COW publishes the new representation.

`push`, `pop`, `shift`, and `unshift` use [`array-view.md`](array-view.md). Other structure-only mutators use their native Array methods on an eligible owned representation, with logical property transitions and method-specific bookkeeping around the call when that representation is already tracked. `reverse` obtains its ordering with `toReversed` on the working Array, then restores the source's reversed index presence so holes match JavaScript `reverse`. Default `sort()` obtains its permutation with `toSorted` over runtime records containing the prepared comparison strings; the comparator overload uses the Promise-aware stable sorter. Both apply the permutation to the logical values and leave holes after explicit `undefined`. `fill` and `copyWithin` use a shallow owned working copy and their native mutators. `splice` retains its standard native property order and partial-failure semantics. A marked owned receiver receives the completed shape back under the copying rule above.

### Results

| Methods | Marked result | Unmarked result |
| --- | --- | --- |
| `copyWithin`, `fill`, `reverse`, `sort` | Published receiver | Transformed Array |
| `push`, `unshift` | New logical length | Transformed Array |
| `pop`, `shift` | Removed value or `undefined` | Shortened Array |
| `splice` | Array of removed property versions | Post-splice Array |

Receiver publication is never inferred from the method result. Every tracked result receives normal ownership preparation. A receiver-returning marked result aliases the published path and makes that identity shared; a wholly removed or newly created result may transfer when it has no other owner.

### Mutation bookkeeping

An unpublished working Array may be completed and indexed once before publication or return. An existing ref-indexed logical Array instead updates storage or view bounds together with method-specific logical-edge bookkeeping; it has no generic affected-range snapshot reconciler. Each method captures only the property versions and placement state its native call can move or replace, applies the exact edge deltas, and finalizes every completed placement before returning a partial-failure Error. An entering edge is prepared and indexed before its contribution is added. A leaving edge removes its reverse-parent multiplicity and Promise/Error/cycle-cut totals. A replacement applies only the old-to-new edge delta.

| Operation | Bookkeeping |
| --- | --- |
| `delete array[index]`, `pop` | Remove the deleted or removed element's contribution when the property exists. |
| `push` | Add each appended element's contribution. |
| `shift` | Remove the first contribution; retained relocation changes no multiplicity or aggregate count. |
| `unshift` | Add inserted contributions; retained relocation changes no multiplicity or aggregate count. |
| `splice` | Remove deleted and add inserted contributions; retained relocation changes no multiplicity or aggregate count. |
| `fill`, `copyWithin` | Apply an edge replacement at each changed destination. |
| `reverse`, `sort` | Permutation changes no multiplicity or aggregate count after any required Promise resolutions. |

Holes have no contribution. Placement-specific state, including cycle cuts and Promise mirrors, is cleared, retained, or recreated for the corresponding logical property even when aggregate counts do not change. ArrayView endpoint contraction removes the changing identity's logical edge even when another view retains the physical element. Storage and bookkeeping steps form one synchronous method-specific transition, so every completed step remains accounted for after a partial failure.

## `length`

Array `length` is a visible, non-enumerable, non-configurable virtual property of every logical Array. Assignment is an ordinary mutation and does not use `run` or require `!`; lowering still identifies the owning Array path because the change is derived from the old value. Setting length follows `ArraySetLength`. Each successfully truncated property detaches its mirror and removes its edge contribution and placement-specific state. Shared, imported, non-extensible, or read-protected Arrays copy before the change. ArrayView rules are in [`array-view.md`](array-view.md).

String `length` is a visible, non-enumerable, non-configurable, read-only virtual property. Its read resolves only the receiver path. Assignment or deletion returns a language Error without changing the receiver; deleting Array `length` does the same.

## Errors

A broken observed path returns its path-access Error. A broken marked path installs that Error under the ordinary mutation rule and returns it. An unmarked missing final receiver, final Error, unsupported receiver, method, overload, argument, native input, or result returns a language Error without invocation. A valid marked mutator on a final non-Array value replaces that value with the validation Error and returns the same Error.

A synchronous invoked-method throw and a returned method-Promise rejection become language Error results. Another marked failure publishes the unchanged receiver or any partial mutation whose completed edge transitions are already accounted for, then returns the operation Error. An unmarked copying mutator discards its private working copy.

A kernel invariant, bookkeeping failure, or trusted-call contract violation is fatal. An installed receiver or result gate remains unresolved after fatal abort.

## Implementation boundary

`src/run.js` owns dispatch, slot classification, preparation coordination, logical Array wrappers, operation gates, mutation results, result admission, and ordinary invocation. `src/array-sort.js` owns default comparison preparation and the Promise-aware comparator sorter. `src/language-coercion.js` owns Promise-aware data-only scalar coercion and locale-input preparation. The surrounding runtime owns argument capture and the export operation used for ordinary trusted native observations. `src/array-view.js` owns ArrayView representation and endpoint transitions. `src/refcounts.js` supplies narrow logical-edge addition, removal, and replacement operations. `src/meta.js` owns reusable read-lease accounting; `src/promise-mirrors.js` owns captured-version sampling and mirror recreation; existing property transitions install and settle receiver gates.

Logical-Array and virtual-`length` access is routed through `src/language-properties.js` for traversal, mutation, import, export, refcounting, Error search, mirrors, and iteration. The observation walker reports final-property presence to `run`, while existing consumers may ignore that additional result. Traversal recognizes virtual String `length` without treating a primitive String as a tracked object; its read-only write and deletion outcome is handled without replacing the String receiver. These adapters may be adopted incrementally while they are identity operations for ordinary Arrays, but attachment must remain disabled until every consumer uses them. `src/index.js` exports `run`; ArrayView and operation-gate helpers remain internal. Callback invocation other than sort comparison, Map/Set support, and proxy-backed mutating class methods are outside this step.

## Verification

Run all coverage in inline-Symbol and WeakMap metadata modes. Cover:

- validation before walking, intrinsic shadowing, ordinary overrides, supported String and Array methods, rejected constructors, unsupported callbacks, protocol objects, RegExp values, iterator results, callable results, and native internal-slot results;
- direct and delayed paths, zero or multiple readiness Promises, assignment-style Promise payloads without waiting, operation leases, gates before required waits, receiver-before-result settlement, supersession, and gate-free ready transitions;
- absence of export for every standard Array and String operation; exact logical locale-input preparation and export of ordinary native invocation snapshots; direct Cascada payloads to structural intrinsics; export Errors; result admission; and no raw ArrayView backing exposure;
- Cascada scalar coercion of primitives, logical Arrays, supported records and instances, own shadows, null prototypes, unsupported executable hooks, direct and nested Promise frontiers, and Errors;
- omitted, direct, invalid, Promise-valued, throwing, rejecting, synchronous, and Promise-returning sort comparators; logical argument identity, result coercion, stable ties, `undefined`, holes, and inconsistent comparator behavior;
- `at`, identity searches, `concat`, `flat`, structure-only copying, full sort preparation, holes, explicit `undefined`, Errors, pending properties, aliases, cycles, and copy-on-write identities;
- every marked and unmarked mutator across owned, shared, imported, non-extensible, read-protected, ancestor-copied, native, attached, and standalone-view receivers;
- exact method results, no-op identity, sparse shapes, non-index properties, argument omission, assignment-style tracked payloads, Promise mirror recreation, and partial failures;
- method-specific edge additions, removals, replacements, retained relocation without recounting, placement-state movement, and bounds-only ArrayView contraction; and
- Array and String length reads, growth, truncation, invalid values, partial truncation failure, mirror detachment, attached views, and logical iteration.
