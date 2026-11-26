# Standard Method `run`

## Failure boundaries

The exact host function or method uses `InvocationFailed`. A controlled comparator uses `ControlledCallbackFailed`. Complete input collection suppresses invocation until every required receiver and argument outcome is known. Controlled Array methods use the index and length facts their captured mapping requires. Internal defects stay fatal, and each fallible host inspection has its own recovery boundary. Each initial or resumed Array step consumes its exact external escapes before leaving the guarded continuation. Scalar coercion and nested logical Array string conversion use `ScalarConversionFailed`. Required preparation completes every selected input before combining its failures. Structural payloads retain their separate value semantics. Unsupported callback outcomes use `InvalidCallbackResult`, and a selected callback Promise retains rejection ownership. A native mutation's direct poison, throw or rejection fails its selected scope. An ordinary native Error result is healthy data. Controlled Array mutations account for their direct result and receiver publication separately. For `a=[E]` containing payload poison, `a!.pop()` returns E and leaves a healthy empty receiver for the next push. Failure importing an independent result graph also leaves valid receiver state available.

## Status

**Implemented.** This is the common invocation layer for standard String and Array operations and managed-record and managed-class methods.

External receivers use the same invocation lifecycle with ordered native access and repair-and-call, as specified in [external ordering](external-context-ordering.md). An external Array uses native receiver semantics and result ownership. Controlled managed Array remaps instead validate fixed namespace indexes before committing; unrelated changes remain valid. Arbitrary managed methods cannot mutate a namespace-bearing receiver.

## Contract

```js
run(chain, path, method, args, operationContext, { mutationScopeDepth, repair, firstDynamicSegment = path.length })
```

`args` is the required Array of explicit arguments. `mutationScopeDepth` is `undefined` for observation; otherwise it is the depth of the selected `!` prefix, where `0` selects the root. Runtime-owned containers and facts are trusted, and retained Arrays are copied before the receiver or any argument settles. Language path segments are validated only when traversal consumes them. After the receiver is classified, internal dispatch rejects `constructor`, an unsupported controlled method, or an unsupported mode without boundary-specific conversion or export. Common ownership preparation may already have inspected fresh arguments and registered their pending deliveries: mutation calls do this before walking the receiver path, and observations do it before waiting for a receiver. A ready observational rejection leaves arguments unconsumed. Rejection neither waits for unused arguments nor collects their Errors. An observational rejection leaves the receiver unchanged; a mutation rejection publishes the Error through the normal receiver transition.

`path` is the complete receiver path and distinguishes a missing final property from one containing `undefined`. The receiver and selected mutation scope may differ; failure after reaching that scope belongs to it. An empty path targets the Chain root. A receiver may be a primitive String, logical Array, managed record/class, or exact external identity. Arrays with an explicit external declaration use native semantics; native Arrays with or without captured ranges and runtime ArrayViews retain controlled Array semantics.

The required `repair` Boolean is normally false. True requires a valid mutation scope. It clears selected managed placement poison to reveal its baseline, and covered external subtree poison, before normal call preparation/invocation under the same required ordering. A new whole-scope failure marks the repaired data. A streaming regional failure publishes the method's declared fallback. Repair does not create authority or revert native effects.

## Dispatch

The intercepted Array mutators are:

```text
copyWithin fill pop push reverse shift sort splice unshift
```

| `mutation` | Resolved call | Behavior |
| --- | --- | --- |
| `false` | Logical Array mutator | Leave the source unchanged and return a distinct transformed logical Array. |
| `false` | Any other supported method | Invoke it as a trusted observation and return its result. |
| `true` | Logical Array mutator | Mutate or publish a new receiver and return the JavaScript mutator result. |
| `true` | Managed method | Isolate, invoke, validate, and publish the receiver; return the method result. |
| Either | External receiver | Export arguments, wait for its selected phase when mutable, and invoke the exact native method. |
| `true` | Unsupported receiver | Publish and return a language Error without invocation. |

A supported logical Array method is selected intrinsically by name even when a receiver property shadows it. Every other Array method name is unsupported; dispatch does not inspect custom properties or prototypes.

Controlled Array table lookup and native String method lookup happen during internal dispatch. String lookup examines only Function-valued data properties on the stable `String.prototype` and `Object.prototype`; boxed indexes, `length`, accessors, and unsupported names are not method candidates. A failed early lookup performs no argument export.

Receiver-path selection happens first, at the captured external turn when native state is involved. It may invoke path getters even when arguments fail; the selected category determines dispatch. This differs from looking up the method member: dynamic managed and external member lookup and invocation require successful input preparation. Detaching a managed receiver ends native access before argument waits; an exact external receiver remains ordered through its call.

Managed-record and managed-class member lookup happens only after their required inputs are clean. A record method is an own enumerable Function-valued placement; inherited properties, accessors, and non-enumerables are unavailable. Managed-class lookup selects a data method once from the prepared receiver's admitted prototype chain up to, but excluding, `Object.prototype`. Unrelated prototype accessors are permitted but are not Cascada methods; declaration rejects a callable or accessor `then`. Selecting an accessor produces `InvalidManagedReceiver` through the ordinary failed-call outcome. Post-admission prototype changes are unsupported and have no diagnostic or recovery guarantee. Failed preparation performs none of this method-member reflection.

A managed call completes receiver and argument data/Error capture before selecting its method; only successful selection resolves alias partitions and allocates receiver and argument copies. A mutating managed scope/receiver must not contain registered mutable external resources; reject it before invocation. Entry coverage grants no exception. Both native modes use a complete independent receiver copy. An observation inherits captured logical identity and needs no gate; a mutation uses fresh receiver identities, the ordinary gate while pending, and publishes only a valid completed receiver. Receiver-source leases end after placement/version capture; mutation recovery baselines remain protected through publication. Shared-graph import protects aliases between a non-receiver mutation result and the receiver. A direct result Promise extends the call; a nested result Promise is ordinary result data and must not later access or expose the receiver. The managed structure of exported argument copies may outlive the call. Exact external identities may be retained or returned inertly but gain no authority. The full contract is in [`managed-invocation.md`](managed-invocation.md).

String methods use the ordinary observation path. Their dispatch protocols, such as `Symbol.match`, `Symbol.replace`, and `Symbol.split`, and callable arguments such as replacement callbacks are part of the same trusted read-only call and are subject to the ordinary exported-argument and result-admission boundaries. Controlled Array intrinsics support the methods declared by the Array method table. `sort` and `toSorted` also support the comparator contract below. Managed Array iteration uses the public `iterate` operation. [Integration contract](integration.md)

Controlled Array dispatch assumes the global `Array`, `Array[Symbol.species]`, standard Array intrinsics, and `Array.prototype` are unmodified.

An observation never publishes its receiver. All nine intercepted mutators return the privately transformed Array in observation mode, including no-ops. With mutation enabled, push/unshift return length, pop/shift return the removed value, splice returns the sparse removed-elements Array, and copyWithin/fill/reverse/sort return the published receiver. Observational splice preserves holes in its transformed copy; toSpliced produces a dense copy.

All three modes can expose a captured placement once its required dependencies are determined. Complete mode holds the affected capture through any possible whole-Array or ancestor failure. Streaming modes publish independent portions of the result under each method's failure rule. A structural Error blocks the affected occurrence. An ordinary Error payload can enter an item binding. Sort comparison failure and invalid length assignment can block the whole Array in every mode. A controlled write commits to canonical logical storage even when a physical cache refuses the change. [Method contracts](array-method-specification.md) Р В РІР‚в„ўР вЂ™Р’В· [Constructed results](../iterate-plan.md#constructed-array-results)

Managed Arrays provide `iterate` for traversal. Callback methods such as `map`, `filter`, `reduce` and `forEach` are outside the controlled method table.

## Language Integration

Lowering captures every argument position before issuing `run`, preserving omission and arity. Ordinary host calls export their explicit arguments as one batch. Controlled Array algorithms convert or consume only their required positions. Common provisional ownership preparation is separate: mutation calls prepare every argument before receiver-path traversal, and observations waiting for a receiver may prepare inputs before selection. This can inspect fresh surplus arguments or subscribe to pending roots. Ready rejected observations leave arguments unconsumed; ultimately unused inputs add no required wait or Error outcome. Select the receiver and dispatch before boundary-specific argument conversion/export; method-member lookup follows successful input preparation. A sort comparator occupies a separate executable slot and is passed directly or as a control Promise without import, export, result admission, or graph storage.

| Boundary | Export |
| --- | --- |
| Controlled Array input | None. Selected algorithm processing resolves its required values and retains logical payloads, including Error and Promise values. Common provisional preparation follows the rule above. |
| `sort` or `toSorted` comparator input | One exported snapshot containing every comparator-visible value. |
| Managed receiver | Capture and copy the complete logical graph in both modes; observations inherit captured identity, while mutation copies are isolated from the scope's protected rollback baseline and receive fresh identities. |
| Managed arguments | Export all explicit arguments of one invocation together, preserving aliases across argument positions and nested paths. |
| Ordinary observation, including a String method | Resolve the receiver through its path; export and resolve every argument before invocation. |

Controlled Array operations read the logical shape and the placements their method consumes. A supplied sort comparator receives exported elements.

Array method producers own their logical write rules. Through the existing remap call they report a nonwriting result or a pending presence decision; the shared invocation path handles output construction, identity publication and independent native results. `fill` calculates its range once for both unused-payload release and write classification. `reverse` and `copyWithin` collect relevant presence during remap capture; `sort` reports from its prepared records. These decisions require no method-name dispatch or separate flag on invocation work.

Retained Array payloads keep their logical identity. This includes Error and Promise values inserted by `push`, `unshift`, `fill`, `splice`, `toSpliced`, or `with`, and values retained by `concat` or `flat`. The Array evaluator transfers selected placements with their ownership and version information.

Call poisoning reaches only inputs required by the selected operation; provisional ownership preparation alone adds no Error obligation. Export consumes every Error reached inside each native-code input. One contextual occurrence is preserved; several are flattened and deduplicated by raw cause, source-context identity, and kind under the [reporting contract](data-limitations.md#deterministic-error-reporting), including its import-source exception. Collected Error order is temporarily unspecified; successful argument positions remain ordered. Any failed required input prevents invocation. If every required input is ready, invocation is synchronous. Otherwise common preparation returns one operation Promise.

Array `toLocaleString` is deferred because it invokes executable element methods. Controlled Array results are runtime-owned. Host-call results are imported because external code may retain them; a direct returned Promise preserves fulfillment while a raw rejection is contextualized to the call boundary. Managed result rules are described in [`managed-invocation.md`](managed-invocation.md).

## Cascada scalar conversion

Host methods perform ordinary JavaScript coercion on exported inputs. Controlled Array indexes, bounds, search `fromIndex`, flat depth, join separator, default sort keys, and Array text conversion use Cascada scalar conversion. A conversion resolves only the inspected value path; unrelated properties and nested Promises are not visited. An Error reached there becomes the operation result.

Implicit conversion of traversable language data is intrinsic and never invokes object protocols. Logical Arrays use recursive intrinsic joining; ordinary records and managed class instances use Object-like default conversion. Null-prototype records and external objects cannot be converted. Properties named `Symbol.toPrimitive`, `toString`, `valueOf`, or `join` remain data and do not affect implicit conversion. Values already exported to native code follow native JavaScript conversion instead.

During intrinsic joining, a nested Array with the same captured logical identity as an active ancestor contributes the empty string at that occurrence. A sibling alias is converted again after the first branch returns. For `c = ["x"]; c[1] = c`, the result of `[c,c].join("|")` is `"x,|x,"`. Resolve a pending identity comparison when it decides whether to descend. Apply the [full-consumption capacity rule](array-method-specification.md#native-diagnostic-list-capacity) only where the conversion actually descends.

Default `sort` and `toSorted` use this conversion for required comparison keys. Explicit and implicit Array joining use it for each required occurrence. Two positions failing the same intrinsic conversion in one invocation produce one leaf. Two positions carrying an earlier poison propagate that original leaf. Separate invocations create their own conversion Errors. A failed required separator stops `join` at argument preparation. [Occurrence and collection rules](array-method-specification.md#failures-in-repeated-occurrences)

## Sort comparison

Without a comparator, each non-`undefined` value is converted to its default comparison string and those strings are ordered lexicographically by UTF-16 code units. These strings are internal preparation, not language-visible keys. Preparing each once is equivalent because traversable-data conversion has no executable hooks. Explicit `undefined` follows all string-compared values without conversion, and `sort` retains holes after `undefined`.

The comparator argument may be a direct callable, `undefined`, or a Promise resolving to either. This includes a Promise produced when control flow selects between comparator bindings. When a comparison is required, the comparator slot consumes and validates that input as executable control. A non-callable non-`undefined` value or rejection becomes a contextual language Error for this operation.

A comparator is invoked with `undefined` as `this` and receives values from one exported dense snapshot. Aliases and cycles are preserved across every comparison, repeated comparisons reuse the same exported identities, and mutations of exported managed values cannot change Cascada state. Holes and explicit `undefined` are ordered without reaching the comparator. The comparator must return a synchronous Number; `NaN` means equality. An Error, Promise, or other result becomes the operation Error.

Capture data presence to establish whether a comparison is needed. Fewer than two sortable occurrences discharge the comparator and default-key conversion, including when a supplied comparator stays pending. An empty or all-hole mutating sort returns the captured receiver and preserves its identity. The hole partition carries each hole's own status to its final position, including through densification in `toSorted`. Otherwise native stable sort orders the sortable placement records. An unreadable candidate remains a failure input. Complete every required conversion or comparator snapshot export and collect its Errors before invoking external code. [Sort dependencies](array-method-specification.md#successful-production)

## Argument readiness

An assignment-style Array payload becomes data at its destination. An installed Promise-valued property has its own version and publication authority. A repeated range can project many logical destinations from a captured producer. Publication maintains the corresponding parent relationships at their ordered turns. A later rejection supplies element poison. [Property versions](../AGENTS.md#property-versions) · [Shared range work](array-method-specification.md#composition-and-release)

`includes`, `indexOf` and `lastIndexOf` consume the needle and bounds only for eligible comparisons. An empty search returns its miss immediately. A definite mismatch discharges an unknown bound for that candidate. An eligible match completes `includes`. Directional searches select the first required match or failure in their search order and skip definitely absent slots. Values compare by managed identity or primitive value.

`concat` classifies each part as a logical Array or a scalar and captures its placements at issuance or delivery. Successfully classified scalars retain their value. Complete mode returns root poison for a failed part. Streaming modes publish a structural Error for the missing contribution. `Symbol.isConcatSpreadable` is ignored. [Array method contract](array-method-specification.md)

Flat and sorting capture placement presence before consuming values, retaining a descriptor failure per candidate and continuing accessible siblings. Sorting also preserves failures reading a captured value until required default conversion or comparator export completes. Candidate discovery respects sparse ArrayView bounds; a failed key-list reflection makes only that interior undiscoverable. Flat depth zero and structural remaps retain payload without inspecting nested contents.

## Array element Promises

Array wrappers use logical properties and never expose ArrayView backing. They resolve direct Promise-valued indexed properties only when the JavaScript operation needs their values:

| Operations | Element handling |
| --- | --- |
| `at` | Resolve only the selected property version. |
| `includes`, `indexOf`, `lastIndexOf` | Use the search-specific rules below. |
| `concat` | Capture receiver and logical-Array item property versions without resolving their elements; resolve each item only to decide whether to spread it. |
| `flat` | Resolve only a candidate whose value must be tested for recursive flattening. Retained values at the depth limit are not resolved. |
| `sort`, `toSorted` | Resolve every present top-level element participating in ordering. Default comparison then prepares strings; a supplied comparator receives the logical values. |
| `join`, intrinsic Array `toString` | Resolve each indexed value the text result inspects and any further Promise reached by its scalar conversion. |
| `push`, `unshift`, `fill`, `splice`, `toSpliced`, `reverse`, `toReversed`, `copyWithin`, `slice`, `with` | Do not resolve elements merely to retain, insert, replace, move, or copy them. |
| `pop`, `shift` | Contract the receiver or produce the shortened copy without awaiting removed payloads; only the mutation's independent removed-value result resolves that Promise. |

A structural copy carries its captured producer and establishes the destination’s independent authority to publish or overwrite its slot. Copying a range that contains a pending marker cause can share its captured subtree and settlement work. Replacing one destination changes only that placement in the new owner. Direct pending assignments keep their ordinary per-placement versions. Sort and text conversion consume the values their algorithms require. [Placement publication](array-method-specification.md#publish-and-retire)

An argument retained as Array payload is not preparation input. `push`, `unshift`, `fill`, `splice`, `toSpliced`, and `with` therefore retain an Error or Promise unchanged in their value positions. A rejected retained Promise later poisons that property version. For a `concat` contribution whose classification is required, a failed part root produces result-root poison in Complete mode and one structural marker in either stream. A captured prefix already at the logical count cap determines the entire retained streaming output. [Contribution and capacity rules](array-method-specification.md#5-endpoint-and-copying-families)

`at` returns the selected logical value and preserves graph identity. A pending selected element produces only the result Promise needed to sample that captured property version.

`fill` and `copyWithin` consume only controls needed to determine their range. For example, `fill(value, pendingStart, 0)` and `copyWithin(pendingTarget, 0, 0)` complete without those pending arguments; `copyWithin(0, 0, pendingEnd)` preserves the receiver without writes. A failed control cannot poison a range while another pending control can still prove it empty or self-copying. Capture the source shape. For example, an earlier optional append after A can leave the count at one or two. Both no-write proofs apply while that issuer stays open. Index zero can be read immediately on the returned receiver or a capacity-safe transformed copy, while a request for its exact length can still wait. Receiver selection, authority and any whole-scope blocker keep their ordinary precedence. These reductions preserve ready/deferred equivalence and do not inspect old payloads to discover equal values.

`sort` and `toSorted` retain the logical values and follow Sort comparison. `sort` leaves holes after explicit `undefined`; `toSorted` follows its standard read-through-holes result. Intrinsic Array `toString` uses intrinsic logical joining. Non-index string properties are outside the Cascada Array surface.

### Mutation identity

The [write-based identity contract](data-limitations.md#managed-identity) classifies controlled Array calls by their logical writes. An empty `fill` range, zero-count or normalized self-copy `copyWithin`, and `reverse` with fewer than two elements publish nothing. Nonempty equal-value `fill`, writes between different copy positions, and reversing two equal present elements are effective. `sort` writes present elements, including a singleton; all-hole sorting publishes nothing. `push`, `unshift`, `pop`, `shift`, and `splice` explicitly write length and are effective even for empty or zero-item calls. These are logical algorithm writes, independent of physical view/remap shortcuts. An explicit equal length assignment is effective. Allocation of a view or copying for protection is representation work, not an additional semantic write. A native mutating call publishes its isolated working receiver and separates affected path ancestors, even when the method writes nothing. All nodes copied for that receiver get fresh identities, including untouched descendants; already-prepared references newly linked during the call retain their captured identities. Unrelated branches retain identity. Completed contents are not compared.

The selected implementation reuses the captured baseline for a nonwriting Array mutation instead of materializing a replacement receiver. Derive its footprint during required argument/presence/remap work, with no second scan; retain required reads, validation, and Error processing. The existing mutation outcome carries this contribution to scope completion, which still accounts for repair or fallback publication. Receiver publication, an independent method result, and any pending gate keep their separate completion rules.

### Identity-sensitive searches

`includes`, `indexOf`, and `lastIndexOf` never export Array elements. `includes` uses SameValueZero and treats holes as `undefined`; `indexOf` and `lastIndexOf` use strict equality and skip holes. Length capture, `fromIndex`, direction, and early termination match JavaScript. Tracked values compare by captured logical identity, never structural equality. Protection/representation copies inherit identity and every semantic write separates it, including an equal-value write. Error elements are ordinary comparable values.

Directional search returns the first eligible match or obstruction in its search direction once earlier candidates are excluded. A definite hole excludes a candidate before either the needle or the range bound is needed. `includes` compares a healthy eligible hole as `undefined` and can finish from any established match. A miss requires excluding every possible hit and structural obstruction. When all hits are excluded, a remaining required obstruction supplies the failure. Close the search’s remaining private work at its final answer. [Search demand and completion](../iterate-plan.md#search-demand-and-completion)

For `[pending, "Z"].includes("Z")`, the definite match closes the result in the issuing turn. Capture earlier comparison versions as needed, probe the ready candidates, and register any still-required waits when available candidates are exhausted. A completed search releases its context while the first payload remains pending. A cursor's already-issued pull can still own its own work after return. [Reader lifetime fixture](../test/fixtures/array-pending-history.mjs)

The [search-completion contract](data-limitations.md#search-completion) permits searches to wait for unresolved publication outcomes rather than combine possible future results to deduce that some candidate must match. A known match still lets `includes` finish immediately; the linked contract gives an example of the permitted wait.

## Path and operation readiness

`mutation` selects `walkMutationPath` or `walkObservationPath` when the call is issued. The request is interpreted only after receiver classification. `walkObservationPath` resolves the complete receiver path, including a Promise-valued final receiver. `walkMutationPath` resolves only through the receiver's owning parent so the terminal can gate a Promise-valued final receiver before waiting.

A path Promise is handled entirely by the selected walker. If post-target work is ready when its continuation reaches the target, the operation completes synchronously inside that continuation and the walker-produced Promise carries the result. Path delay alone creates no receiver gate or additional wrapper.

After receiver selection, the common invocation lifecycle starts category-specific preparation. Dynamic record and managed-class members resolve once after successful preparation. Protect each traversable input for as long as the call can still read it or needs it for publication. A capture that owns all remaining placements and shape facts takes over that protection. Searches retain their captured comparisons. `concat` retains its contributing ranges through handoff to the result producer. [Source retention](array-method-specification.md#restrict-source-retention-through-the-mapping)

For example, an observation `a.toSorted(cmp)` on `[2,1]` can finish reading the receiver before `cmp` settles. After whole-location replacement, its captured inputs still supply the eventual result and the former source Array can be collected. A still-unread receiver or an independent holder has its own lifetime. Invocation closure stops operation work after required publication and result processing. Late continuations in a live execution first finish shared settlement and bookkeeping. Execution fatality stops both.

`run` in mutation mode calls `walkMutationPath` directly. Its terminal callback passes the reached target to `transformProperty`, which captures that property version and invokes the operation callback with the resolved receiver and mutation work. The common invocation lifecycle prepares and retains arguments before this mutation walk, including fresh wrappers containing borrowed path ancestors. Receiver selection determines boundary-specific argument conversion; method-member lookup follows successful input preparation. The operation callback contains no parent, key, Promise version, gate, publication, or path-walking logic.

Ready work publishes synchronously, including on resumption after path selection. An unresolved whole-Array or ancestor failure reserves the affected scope before suspension. Once that scope is safe, a streaming controlled method can publish independently determined receiver facts while its direct result or another region stays pending. Receiver and argument readiness can overlap. Read a Promise-valued receiver from its captured version after its preceding FIFO transitions. [Publication by family](array-method-specification.md#publication-by-method-family)

Once preparation completes, the callback performs one synchronous transition. `transformProperty` publishes the receiver before its independent result, applying the normal assignment, import, Promise version, and copy-on-write rules. If the receiver property was superseded, its detached gate Promise version no longer publishes there, but the result Promise still completes. An assignment-style payload Promise is data rather than readiness. A Promise removed by `pop` or `shift` may delay only the independent method result after the synchronous receiver transition.

Target publication and every enclosing writeback retain the operation result and combine each newly caused publication failure. Failed gate installation still preserves required in-flight result work. A successfully installed gate's completion subscribes at issuance, after shared settlement and before later operations, and reads that captured version's published logical outcome. This captures publication failure without including changes caused by later work. Receiver protection ends with publication; independent-result collection can continue after healthy replacement of failed state.

The common continuation helper performs each required ordinary `.then` subscription at its program position. The native Promise or supported custom thenable owns FIFO delivery across settlement and chaining; a later ready subscription cannot overtake an earlier undelivered callback. A ready custom callback returns its normalized transition result directly, while a pending subscription returns its chain. A transition consumes any further possible thenable before returning, so only an actually pending chain remains in that result position. That result identifies pending work for aggregate waits; pending-only protection also follows the selected receiver and unfinished publication or capture dependency. An independent result cannot extend completed receiver publication or path selection. Callback execution and receiver, remap, result-slot, or Promise version backwrites are not readiness flags. Cascada keeps no canonical Promise or parallel subscriber queue. `async`/`await`, `queueMicrotask`, or a proxy Promise must not split an ordering-sensitive transition or add a microtask to already-ready custom work. Returning an independent result Promise does not replace the source's settlement mechanism.

## Array mutation and representation

While traversing to the receiver's owning parent, `walkMutationPath` calls `metadata.requiresCopyOnWrite(value)` on each path object. The first `true` starts path copy-on-write through the owning parent.

Observation preserves its captured receiver. A mutation with whole-scope failure keeps candidate writes private until that failure is excluded. A streaming regional mutation publishes each determined fact through the same ordered transition. For `a=[A,B]; a!.splice(1,p,X)`, a later write to index zero can commit in a stream while p stays pending. If p fails, the write survives and index two carries the deletion-count failure. Complete mode gates that write. On failure, repair exposes the original A. Existing ownership and path COW protect earlier captures in each case. [Ordered publication](../iterate-plan.md#4-ordering-and-irreversible-publication)

Endpoint edits can derive an ArrayView, a numeric slice can share a bounded range, and an eligible concat can extend the receiver’s hidden backing. The representation supplies the method’s published placements and keeps each earlier owner’s captured value intact.

Controlled structural methods map endpoints, ranges and captured placements directly. A ready append or concat can extend eligible backing without reading its prefix. A derived view copies owner-local versions at its FIFO position and projects canonical backing producers through its bounds. Each retained placement preserves its value and failure attribution. After root validity, a determined slot is accessible while an independent slot remains pending. A single captured range can establish this for many slots. Default and comparator sort share one placement-record pipeline. [Array storage](array-view.md#representation)

### Results

| Methods | Mutation result | Observation result |
| --- | --- | --- |
| `copyWithin`, `fill`, `reverse`, `sort` | Published receiver | Transformed Array |
| `push`, `unshift` | New logical length | Transformed Array |
| `pop`, `shift` | Removed value or `undefined` | Shortened Array |
| `splice` | Array of removed property versions | Transformed Array |

Receiver publication is never inferred from the method result. Every graph-identity result receives normal ownership preparation. A receiver-returning mutation result aliases the published path and makes that identity shared; a wholly removed or newly created result may transfer when it has no other owner.

### Mutation bookkeeping

An unpublished working Array may be completed and indexed once before publication or return. Each independently published region updates the corresponding placements at its own transition. Direct changes to an indexed logical Array use ordinary placement publication. Prepare and index an entering edge before adding its contribution. A leaving edge removes its reverse-parent multiplicity and Promise/Error/cycle-cut totals. A replacement applies the old-to-new edge delta.

Apply the delta to the successor after its capacity projection and count clip. A pure permutation can preserve aggregate multiplicities while changing parent keys. A remap that loses a child removes its occurrence from this owner and accounts for the resulting structural Error. A deletion at a retained virtual index replaces the old tail cause with the deletion's capacity cause. Earlier captures retain their own parents and causes. [Per-operation capacity](../iterate-plan.md#preserve-loss-at-each-operation)

Project the affected keys and counts through the maintained ranges. A hole contributes no managed-child edge. Its own flag still contributes to visible Error queries. Carry placement-specific versions and cycle cuts to their prescribed positions and publish the bookkeeping in the same transition as the data. [Placement publication](array-method-specification.md#publish-and-retire)

## `length`

Array `length` is a visible, non-enumerable, non-configurable intrinsic property of every logical Array. The mutation walk classifies a terminal property before treating it as a graph edge: ordinary properties target that edge, while intrinsic `length` targets the receiver's enclosing placement. `transformProperty` gates that placement when conversion or conflicting transitions remain pending. The payload is converted only after the receiver is known to be a logical Array; another object's `length` remains an ordinary property and may hold a Promise. Assignment uses the ordinary protected scope baseline and publishes a new Array of the requested length with only its retained placements. It waits for transitions in the truncated suffix without consuming their ordinary payloads or delaying retained-prefix entries. [ArrayView](array-view.md#materialization-and-length) describes representation and backing reuse.

String `length` is a visible, non-enumerable, non-configurable, read-only intrinsic property. Its read resolves only the receiver path. Without an explicit ancestor scope, assignment or deletion poisons the receiver placement and returns the same language Error; deleting Array `length` does the same.

A `run` receiver path ending at either intrinsic `length` selects a number, never an Array. Without an explicit ancestor scope, mutation mode poisons the containing receiver placement or root and returns the same Error, because intrinsic length is not itself a graph placement.

## Errors

`run` returns `T | PoisonError | Promise<T | PoisonError>`. A ready Error is directly inspectable; a pending call fulfills with its ordinary Error after required graph effects and complete preparation. A result retained by Cascada goes into an operation Chain; `lookupPathForExpression` supplies rejecting transport only when that result enters an expression.

A mutation may capture an independent removed-value Error before completing receiver work. Combine the failures its direct result owes. Publish each receiver failure at its specified scope. Committed streaming regions and successful removals survive an independent result failure. [Receiver and direct results](array-method-specification.md#1-one-operation-separate-outcomes)

A broken observation path returns its path-access Error. A broken mutation path installs that Error under the ordinary mutation rule and returns it. An observation with a missing final receiver, final Error, Error-valued selected method, Error-poisoned argument, unsupported receiver, method, overload, or native input returns a language Error without invocation. Errors contained in receiver elements or properties remain data unless the selected operation consumes and converts that value. A mutation rejected after receiver classification publishes its validation Error through the selected scope transition and returns that Error. A blocking scope instead returns its original poison without descending further or performing boundary-specific argument processing. Common argument ownership preparation precedes that scope check; unused inputs are released without waiting or adding their Errors to the outcome.

A synchronous supported-method, callback, accessor, or reflection throw becomes a `PoisonError` at the causal boundary. An ordinary native Error returned or fulfilled as data succeeds. A failed opaque mutation publishes status at its selected scope. Controlled Array failures follow the mode and method’s footprint. Existing contextualized failures propagate unchanged. A raw direct method-Promise rejection is attributed to the call. At unlimited depth, `flat` reports a recursive edge as `InvalidArrayOperation`. Complete mode fails the result. A stream publishes a marker at that edge and keeps independent contributions. Finite depth retains the unconsumed placements. Complete-mode overflow returns `InvalidArrayLength`. A streaming expansion marks newly lost positions with structural capacity Error. [Flattening and failure](array-method-specification.md#discovery-and-payload-retention)

A kernel invariant, bookkeeping failure, or unsafe host behavior that compromises runtime state or ordering becomes a fatal `FatalError` at the owning operation and is reported once by that execution. Safely rejectable host output validation instead produces poison. Descriptor restrictions are handled by representation preflight. A supported host reflection or required storage-write failure still produces poison at its causal boundary; an unexpected internal commit failure remains fatal. Supported external code must not synchronously re-enter the same execution; attempted same-execution re-entry is fatal, while another execution remains independent.

## Implementation boundary

`src/run.js` owns path routing and top-level receiver classification. `src/invocation.js` owns common preparation, protection, invocation, result admission, and lease cleanup, together with ordinary host-call selection and native calls. Managed invocation selects its member after complete preparation and before isolation, returning the required mutation outcome when selection fails. `src/operation-lifecycle.js` owns operation closure and release registration for pending nested resources; `src/internal-step.js` owns immediate and deferred guarded operation work, value consumption, complete input collection, and clean-input preparation. `src/export.js` owns `exportValue`, `exportManyValues`, copying, Error collection, and output lifetime. `src/mutations.js` owns path copying, receiver replacement, Promise gates, and `transformProperty`. `src/mutate-property.js` owns assignment and deletion commands, including Array length assignment and truncated-suffix transition waits; `src/language-properties.js` owns terminal-property classification, descriptors, validation, and physical language-property access. `src/property-versions.js` owns exact property versions, placement, publication, and validated deletion. `src/array-methods.js` declares and implements supported Array methods, while `src/array-invocation.js` owns Array call selection and interprets those declarations. `src/array-remap.js` owns property-placement remaps, transfer, and materialization. `src/observations.js` owns observation-path behavior. `src/error.js` owns Error conversion and combination. `src/language-conversion.js` owns Promise-aware scalar conversion required by logical wrappers. `src/array-view.js` owns ArrayView representation, backing preflight, endpoint transitions, and bounds. `src/refcounts.js` owns logical-edge accounting. `src/data-declarations.js` owns data declarations, `src/input-preparations.js` owns the inbound admission walk, and `src/meta.js` owns identity facts and read leases.

Logical-Array and intrinsic-`length` access is routed through `src/language-properties.js` for every graph operation. Traversal recognizes String `length` without treating a primitive String as a traversable object. `src/index.js` exports `run`; ArrayView and derived-assignment helpers remain internal. Array callback methods other than sort comparison and managed Map/Set support remain future work. Proxy-backed managed data follows the [managed-storage contract](data-limitations.md#proxies-in-managed-storage).

## Verification

Run the complete suite. Do not duplicate the JavaScript engine's intrinsic method-algorithm tests; cover the Cascada boundary:

- path-segment validation during traversal, category validation after classification, controlled Array dispatch, rejected constructors, String protocols and callbacks, deferred Array callbacks, and external results;
- direct and delayed paths, zero or multiple readiness Promises, concurrent receiver and argument preparation, assignment-style Promise payloads without waiting, operation leases, gates before returning from required waits, receiver-before-result settlement, supersession, and gate-free ready transitions;
- argument export boundaries, logical preparation, direct ordinary receivers, result admission, and no raw ArrayView backing exposure;
- Cascada scalar conversion of primitives, logical Arrays, supported records and instances, null prototypes, external objects, direct and nested Promise frontiers, and Errors, including ignoring protocol-named data properties;
- direct, invalid, promised, throwing, and Promise-returning sort comparators, including exported snapshot identity, exact Number results, stable ties, `undefined`, and holes;
- native structural delegation through property-placement remaps, including lazy in-place reads, duplicate Promise identities, argument omission, Promise version recreation, aliases, Errors, and copy-on-write identities;
- Promise-specific `at`, search, `flat`, text conversion, and sort timing, including early termination and concurrent independent preparation;
- mutation and observational mutator calls across owned, shared, imported, protected, native, and viewed receivers, including descriptor fallback, poisoning, and edge bookkeeping; and
- Array and String length reads, growth, truncation, invalid values, restricted representations, Promise version detachment, and captured Array ranges; and
- bounded seeded differential comparisons with native Array, String, indexed-property, deletion, and length behavior across direct, Promise, copy-on-write, bounded or restricted ArrayView, attached-version, and mixed FIFO modes.
