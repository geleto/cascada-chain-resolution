# First-Principles Conformance Plan

## Purpose

This plan brings the remaining `src` behavior into conformance with the first principles in [`AGENTS.md`](../AGENTS.md). Phases appear in implementation order. Keep completed phases, but replace proposals with their final design.

`AGENTS.md` is authoritative for settled contracts. Source and tests are authoritative for completed mechanisms.

## Method

Implement each phase independently. After every phase:

- reproduce the affected behavior and add integration coverage;
- run the complete suite;
- run `test/verify-refcounts.js`; and
- review the result for structural simplifications, unifications, dead weight, and load-bearing complexity.

Prefer one general transition over special cases. Do not pin helper boundaries, mirror fields, cycle-cut placement, exact counters, or another interchangeable representation. Delete superseded mechanisms in the same change.

Baseline: commit `3d5a47a` (2026-08-06), with 648 tests passing in each metadata mode.

## Shared design constraints

- Imported identities and their physical storage are never modified, except when an explicitly requested mutation operates on the exact opaque identity.
- Observations and mutations may change runtime-owned representation when their logical results are correct and every value they must preserve remains unchanged.
- Sharing and leasing protect logical values, not runtime-owned backing storage. Fixed ArrayView bounds may protect an old value while another value extends the backing; a raw reference may observe its physical length change while every protected Cascada value remains logically unchanged.
- COW or materialization is required when representation reuse would change a protected logical value, when an operation needs owned storage for imported data, or when the current physical representation cannot perform an otherwise valid logical transition.
- Host-call arguments are exported. Result admission imports new host identities and applies each receiver category's ownership rule to identities deliberately supplied to host code.
- Controlled runtime methods are the only methods that receive Cascada values directly. Every explicit argument resolves for Error propagation; the method otherwise resolves only nested data it consumes and reuses backing whenever the rules above permit it.
- Registered instances and their state retain ordinary graph ownership. Complete-state isolation begins only when JavaScript receives a registered receiver: every registered invocation uses a private prototype-preserving snapshot.
- Graph poisoning and API failure are independent outputs. An observation failure affects only its result. A mutation poisoned before invocation or by a synchronous throw replaces its targeted receiver placement or root with the Error and exposes the same Error through the API. A Promise returned by invoked code keeps its own fulfillment and rejection outcome. No consumed Error is lost.
- A fatal failure belongs to the runtime mechanism or its declared kernel or host contract, not to the requested language operation. Broken invariants and bookkeeping belong here. Whether a failure was thrown does not determine its class.

---

## Phase 0: Remove the ArrayView prepend optimization

Complete.

### Final design

- An ArrayView has fixed start and end bounds and reads through one effective backing; a logical index translates by the start bound.
- `unshift` mutates a sole-owned native Array directly and otherwise uses the remap path. It does not move storage shared by fixed views.
- Array method dispatch has no prepend-specific view strategy.
- ArrayView attachment still pins the raw Array's current logical bounds, allowing later values to reuse its backing without changing earlier values.
- Existing and revised integration tests verify behavior and the language surface without pinning private field names.

### Verification

- `unshift` matches JavaScript for owned and preserved receivers.
- Earlier values remain unchanged across `slice` and repeated `unshift` operations.
- Append at the physical endpoint still reuses runtime-owned backing while earlier fixed views remain unchanged.
- The complete suite passes 648 tests in both metadata modes, including the refcount oracle.

---

## Phase 1: Ref indexing must not create sharing

Complete.

### Final design

- Ref indexing records counters, reverse parent edges, and cycle cuts; it records no ownership.
- A DFS back edge becomes a cycle cut without making its target shared. `setCycleCut` alone keeps the reverse-parent projection acyclic.
- Multiple paths from one owner to the same identity, including aliases and cycles, do not change later mutation strategy. Real additional owners, leases, and import retain their existing protection.

### Verification

- An exclusive cyclic or diamond graph behaves identically with and without a preceding Error query.
- Index creation and cycle-cut placement do not create sharing or change a later mutation strategy.
- Real sharing, leases, and import still preserve their logical values, including through ArrayView reuse.
- The complete suite passes 649 tests in both metadata modes, including the refcount oracle.

[`cycles-as-data.md`](cycles-as-data.md) records the ownership-independent projection rule.

---

## Phase 2A: Separate logical failures from representation limits

Complete.

### Final design

- A live mirror supplies its logical value before physical inspection. Otherwise a graph placement is exactly an own enumerable string-keyed data property; accessors, non-enumerables, inherited properties, and missing keys are absent and are never invoked.
- Reads, enumeration, import, COW, indexing, and mutation use that one property policy. Exact user-controlled reflection is captured at the primitive that invokes it; the owning operation returns or publishes its Error while adjacent runtime failures remain fatal.
- A physical blocker is a representation condition, not a language Error. Ordinary mutation uses the same path-copy fallback as COW. Final assignment shadows a physical non-placement in the new container, and final deletion treats it as absent.
- Ordinary native Array mutation runs once against a lazy traced remap. It preflights only the recorded operations, then either completes them on normal storage or commits them once to the receiver. Invalid Array length remains poison, while read-only length, blocked shrink, ArrayView growth, and restricted element commits are representation fallback.
- A failed mutation preparation, logical transition, or synchronous mutating-function call replaces the nearest receiver placement or root that represents the failed transition and returns the same Error. Observations return an Error without changing their receiver; an independent result failure does not poison an otherwise valid mutation.
- A final missing read is `undefined`, assignment creates the placement, and deletion is a no-op. Traversal through missing, `undefined`, or primitive data publishes one path Error at the first failed mutation segment. Reaching an existing Error preserves and returns that identity.
- Invalid intrinsic targets poison their receiver placement. Request validation before `run` captures a receiver remains an API-only Error.
- Supported host calls, controlled callbacks, and reflection hooks reject synchronous Cascada re-entry as a fatal host-contract violation. Trusted `enter` callbacks retain their existing fatal-abort behavior.
- If import fails after marking an identity, a later explicit import revisits that identity and resumes admission instead of treating the partial metadata as completion.
- The obsolete property-shape Error set and Array replay catch are gone. Normal property helpers keep their ordinary return types; one private boundary-failure signal carries exact thrown user code to the owning transition.

### Verification

- Integration coverage verifies absent accessors and non-enumerables, representation fallback, missing-value semantics, poisoning and refcounts, exact reflection failures, and fatal synchronous re-entry.
- Imported and protected sources remain unchanged; valid mutations on ordinary restricted storage materialize only when the planned transition needs it.
- Existing `enter` callback failure tests retain fatal abort semantics.
- The complete suite passes 668 tests in both metadata modes, including the refcount oracle.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and [`import-preparation.md`](import-preparation.md) record the completed behavior.

---

## Phase 2B: Separate API Promise transport and Error aggregation

Complete.

### Final design

- Graph-value rejection becomes poison, trusted-transition rejection is fatal, and a data or host result preserves its Promise outcome. Canonical Promises are used only for ordered runtime continuations, not to convert results.
- Return the produced result unchanged: a value or Error directly, and a Promise or thenable with its original fulfillment or rejection. If producing it was already pending, the existing operation Promise adopts it. Result rejection does not retroactively poison published state.
- When settlement must admit a fulfilled host value or release a lease, register an internal FIFO observer without replacing the result.
- Scope leases to actual pending use. Controlled argument preparation releases its receiver before invocation; a controlled method that continues reading its receiver owns that lease itself. An independent controlled result never prolongs receiver protection. Host-call resources remain active through a returned Promise only where host code may still retain them.
- Ready `assignPath` and `deletePath` failures return their Error. Successful and suspended calls return `undefined`; later poison is published in the graph without a hidden result rejection.
- Internal bookkeeping observers handle their own failures and leave no unhandled rejection.
- `combineErrors` deduplicates top-level Error identities in supplied order, returns one unchanged, and combines several without flattening an existing `.errors` payload. Each caller supplies its message; export retains `export: branch contains errors`.

### Verification

- A selected observation executable that throws synchronously returns its Error. A selected mutating executable that throws synchronously also poisons its receiver.
- A rejected graph Promise poisons its captured property version. An operation that observes that transition produces the Error, while `hasError`, `getErrors`, and other Error consumers produce their declared results.
- A Promise returned by supported data or host execution preserves fulfillment and rejection and changes no graph state merely because it rejects or fulfills with an Error.
- Ready `assignPath` and `deletePath` failures return an Error; successful and pending work returns `undefined`, with no hidden derived rejection.
- Direct and delayed synchronous invocation failures produce the same graph and Error result.
- Runtime bookkeeping observers do not replace the public result or create additional unhandled rejections.
- Pending controlled arguments preserve the captured receiver until invocation. A captured independent result does not force later mutation to copy that receiver, while an ordered search that continues reading after a pending element does.
- Whenever preparation supplies one Error to combination, it propagates unchanged; several preserve every distinct top-level identity and their supplied order without flattening existing payloads. Phase 8 completes discovery across mixed ready and pending call inputs.
- Export and later consumers use the same Error-combination utility.
- `enter` callback throws and callback-Promise rejection remain fatal trusted-transition failures.

The complete suite passes 679 tests in both metadata modes, including the
refcount oracle.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and
[`export-error-set.md`](export-error-set.md) record the completed behavior.

---

## Phase 3: Use one external metadata store

Complete.

### Problem

Inline metadata modifies runtime identities, must migrate when an identity becomes imported, and forces every metadata operation through a storage-mode branch. Metadata location therefore carries meaning that does not belong to the identity's semantics.

### Final design

All identity metadata lives in one `WeakMap`:

- make `metaOf` a direct `WeakMap.get`, which safely returns `undefined` for values that cannot have metadata and triggers no Proxy reflection;
- insert new records only in that map;
- remove `ensureMeta`'s storage-location option, the metadata Symbol, inline/WeakMap switch, import migration, mode files, scripts, test plumbing, and documentation obligations; and
- keep imported and runtime-owned values physically unchanged by bookkeeping.

A representative logical-property-read benchmark showed no regression; the
direct lookup was the fastest measured path.

### Verification

- Metadata lookup changes no identity and triggers no Proxy reflection.
- Imported language containers carry metadata without physical modification.
- Existing conformant ownership, Promise-version, ArrayView, and refcount behavior is unchanged.
- The complete suite passes 679 tests through the single metadata store, and
  the refcount oracle passes.
- Active documentation describes only external metadata.

---

## Phase 4: Establish data-type and identity classification

Complete.

### Final design

Every available value has one admitted category represented by named numeric constants, never strings or constructor names:

```js
const TYPE_ERROR = 1
const TYPE_ARRAY = 2
const TYPE_FUNCTION = 3
const TYPE_STRING = 4
const TYPE_PRIMITIVE = 5
const TYPE_RECORD = 6
const TYPE_REGISTERED = 7
const TYPE_OPAQUE = 8
```

The numbers carry no ordering. A callable thenable is resolved at its captured
property version before its available result is admitted; Promise therefore
has no type constant. Error is available terminal data and has `TYPE_ERROR`.

Admission is the sole ordinary type-classification boundary. `admitValue`
samples thenability at the current program position and leaves a pending
Promise unclassified. Its first callable `then` and optional native FIFO queue
live in separate Promise-capture state, so pending transport never creates
typeless value metadata. Continuation registration invokes that exact function,
and no layer reads `then` again.

`getOrCreateMeta(value, knownType?)` is the sole metadata-record creator.
Existing records win; a known runtime-created type avoids reflection; otherwise
creation classifies the available value and stores all resulting facts
atomically. `admitReadyValue` delegates to it without replacing the input.
If classification reflection cannot identify a supported structure, creation
conservatively admits that object unchanged as opaque. A non-fatal failure while
sampling or invoking `then` is captured as that Promise's rejection and follows
the ordinary property-version resolver.
Every created metadata record therefore has a fixed type, and every later
operation requires and extends that record.

Class registration records the exact prototype in a dedicated `Set`; it
does not admit or attach metadata to the prototype. An admitted instance stores
that exact prototype with `TYPE_REGISTERED`. The registry and instance metadata
are separate because a subclass prototype may itself be admitted as an
instance of its registered base while also defining another registered class.
An instance admitted before registration remains opaque. Type and class
definition remain fixed across later registration and prototype mutation.
Records and registered instances use one admitted `prototype` fact for copying;
later work never re-reflects on the value to derive it.

Records, Arrays, and registered instances are traversable. Functions, Errors,
and opaque identities can carry import, ownership, and lease facts, but graph
traversal stops at them. `new Chain(value)` admits its root without changing
ownership or import status; normal property reads admit children before any
identity fact is recorded.

Semantic category decisions consume admitted type. The class registry is read
only during first admission; later decisions never reclassify an instance from
its prototype. Other structural checks remain only for representation and
property shape. `isTracked`, typeless metadata, and public semantic prototype
classification are gone. This phase preserves the import-origin rules that
Phase 6 will replace.

### Verification

- Every category in `AGENTS.md` is classified independently of method name, using named numeric constants.
- A Promise is resolved before classification; an Error is classified as available terminal data.
- Thenability is sampled once at a program position; both callable and non-callable samples are covered, and direct admission leaves a Promise identity unclassified.
- A fresh assigned graph is admitted at issuance, so nested Promise discovery protects any COW attachment before later mutation.
- An admitted Error remains `TYPE_ERROR` after prototype mutation makes `instanceof Error` false.
- Class registration uses a dedicated `Set` of exact prototypes and neither admits nor modifies them.
- Admitting a registered subclass prototype preserves both its base-instance classification and its own class definition.
- Metadata creation classifies the available value or accepts its known runtime-created type; every created record is typed.
- Callable-then capture uses separate Promise state and creates no value metadata.
- A previously unseen child is admitted before extraction, sharing, leasing, indexing, or Promise-mirror installation records facts on it.
- A class registered before admission is registered data; an instance admitted first remains opaque.
- Array and Promise subclasses retain Array and Promise semantics even if registered.
- Every semantic category decision uses admitted type; remaining structural predicates cannot override it.
- Import, extraction, and leases record identity facts on opaque instances without traversing them.
- Classification lookup after admission adds no Proxy reflection, and prototype mutation changes neither type nor admitted prototype.
- A classification reflection trap preserves the exact object and admits it as opaque.
- Non-fatal synchronous `then` acquisition and invocation failures become captured rejections; ordinary Promise resolution publishes their Errors without changing imported storage.
- `new Chain` admits type while preserving ownership status.
- Invalid class registration is reported as a fatal host-contract failure.
- The complete suite passes 700 tests through the single metadata store,
  including the refcount oracle.

---

## Phase 5: Prepare registered receivers at invocation

### Problem

Registered instances correctly participate in the ordinary language graph, but JavaScript class code currently receives their physical receiver directly. It can therefore observe unresolved Promises and internal representations or mutate nested state without isolating prior and imported owners. Making every graph operation treat the receiver as one permanent atomic ownership unit would solve a boundary problem at the wrong scope and duplicate ordinary COW, import, indexing, and Promise machinery.

### Design

[`registered-class-invocation.md`](registered-class-invocation.md) is the detailed architecture. Registered instances remain ordinary traversable graph data: assignment, deletion, lookup, import, `enter`, refcounting, Promise mirrors, and path COW gain no registered-specific ownership or transition path.

Rewrite the raw graph walk as one operation-local snapshot copier. It copies every available value synchronously, captures pending property versions through mirrors, and preserves aliases, cycles, sparse Arrays, key order, and aliases shared across receiver and arguments. Its source-to-copy `WeakMap` is also its copy-cycle state. Delete the current `onError`, `preserveErrors`, and separate copy-walk `visited` mechanisms. Errors and exact terminal identities may remain in the private copy during preparation; later inspection decides whether the selected boundary permits them. The engine has two container forms—host-call snapshots preserve admitted registered prototypes while public export normalizes them to plain data—and two inspection policies: ordinary host input permits exact opaque and Function leaves, while registered state does not. Multiple roots share the same copy graph.

After all copied roots are ready, inspect them synchronously in receiver-then-argument order. An identity visited under one inspection policy must still be inspected under the other, including when its permissive path is encountered first. One shared seen-Error set establishes deterministic Error order without asynchronous per-input buckets. Existing Errors are appended unchanged; unsupported registered-state values contribute a new validation Error. Either poison skips invocation. While copying, inspect each source registered identity's raw own surface before normalization; a reflection failure is preparation poison, while a successfully observed forbidden surface is fatal. After mutation, validate every private container before publication. Supported Array structure and internal representations retain their declared exceptions. Private fields, internal slots, and closure state remain trusted restrictions that cannot be diagnosed exhaustively.

Capture the requested receiver path and explicit argument values when the call is issued. Traverse and register receiver-path dependencies before argument preparation, capturing the final receiver placement and each nested property version when reached. Each transition exhausts its complete available snapshot frontier before returning; every unresolved branch is captured through its property mirror and copied synchronously when its FIFO continuation resumes. Later source mutation can therefore affect neither already copied data nor pending captured versions, so no source lease is needed. Once the receiver is available, select and capture the class descriptor from its admitted prototype chain before that transition yields; an own enumerable data placement shadows it.

An observation deliberately copies the complete receiver because arbitrary class code may inspect any reachable state; it invokes once on the clean isolated snapshot and discards it. A mutation invokes once and synchronously on the private snapshot. Invoke registered code through the established supported-user-code boundary, where synchronous Cascada reentry is fatal. Pending preparation installs the ordinary transition gate at the captured receiver placement. Preparation poison or a synchronous throw poisons that placement; success performs one final validation walk that admits the complete receiver and records its identities in a `WeakSet`, then publishes the root once through ordinary replacement. That replacement alone owns any required indexing and reverse-edge maintenance. Publication preserves aliases inside the snapshot but severs aliases between copied receiver state and external graph placements, whose previous identities and logical values remain unchanged.

A setter receives one resolved exported value and ignores its return, including a thenable, exactly as JavaScript assignment does. A setter-only accessor reads as `undefined`; assigning through a getter-only accessor produces the Phase 2A language Error. Deletion and assignment not handled by a registered accessor remain ordinary placement operations.

A method-returned Promise remains only the independent API result. Publish successful receiver state immediately, preserve the Promise unchanged, and lease the published receiver until settlement. Result admission preserves the existing origin of exact unsnapshotted opaque and Function arguments, and retains and stops at identities in the final validation `WeakSet`. Every other identity, including a piece removed from the private snapshot, is imported. Keep the call-scoped origin facts through returned-Promise settlement.

Do not add `unitRoot`, registered-unit import state, global readiness, copy-in/copy-out rules, registered-specific indexing, or registered-specific branches to ordinary graph operations. The complete snapshot is an invocation boundary, not a permanent ownership model.

### Verification

- Ready observations and mutations invoke and return synchronously; pending receiver state preserves receiver-before-argument FIFO registration.
- `Vec3` methods and accessors receive settled primitives and prototype-preserving state. `Line3` methods preserve the prototypes, aliases, and cycles of nested `Vec3` values and may synchronously mutate both endpoints.
- Runtime-owned and imported registered state may contain Promises. Invocation resolves the complete reachable frontier through captured mirrors without writing Promise values into the snapshot or changing imported storage; rejection contributes poison and skips the call.
- An unsupported reachable value produces preparation poison without invoking registered code. An invalid own-property surface is fatal, while undetectable private, internal-slot, and closure-state violations remain outside runtime diagnosis.
- Snapshot preparation preserves aliases across receiver and arguments, sparse Arrays, logical Array contents, cycles, and admitted registered prototypes while exposing no ArrayView or original traversable graph identity.
- A Function or opaque identity allowed as an exact argument still poisons preparation when the same identity is also reached from registered state, including when the permissive path is encountered first within one argument graph.
- Publication preserves aliases within the receiver but severs an alias from receiver state to an external graph placement, leaving the external placement on its prior identity even when another receiver branch is mutated.
- A protected, imported, or otherwise aliased source receiver and all prior owners remain logically unchanged after host mutation. Ordinary property and path mutation outside registered invocation still uses normal per-identity COW.
- An observation that physically writes its snapshot cannot change Cascada state. A successful mutation publishes its complete snapshot once; preparation poison or a synchronous throw publishes the Error at the receiver placement; invalid final state is fatal and unpublished.
- A registered setter ignores its return value, including a thenable, and still must finish state mutation synchronously.
- A returned Promise preserves fulfillment or rejection, does not delay receiver publication, and leases the published receiver until settlement.
- Direct and promised mixed results preserve origin for exact unsnapshotted opaque and Function arguments and for identities reached by final validation of a published mutation receiver. Result admission stops at those identities; observation snapshots and every other new host identity are imported.
- Registered arguments retain their admitted prototypes in host-call snapshots, while public export of the same values remains plain data.
- Mutation through an indexed parent preserves counters, cuts, and reverse-parent edges through ordinary replacement; an unindexed replacement remains eligible for lazy indexing.
- Accessor selection uses the admitted class chain. Own state shadows accessors; getter-only, setter-only, missing, throwing, and non-callable cases retain their declared language behavior.
- Receiver-path registration precedes argument preparation; the receiver and nested versions are captured when reached, and replacing a class descriptor after its receiver was prepared cannot change the selected callable.
- Source reflection failure becomes preparation poison, while synchronous Cascada reentry from a registered method or accessor is fatal.
- Public export still returns one Error unchanged and combines several distinct reachable Errors without flattening, using `export: branch contains errors`; ready and pending export produce the same outcome, without pinning Error order within one composite input.
- Host-argument snapshots retain nested Errors until ordered call inspection consumes them rather than turning each argument into an independent export outcome.
- No ordinary graph operation stores or consults registered-unit membership or whole-unit ownership state.

Update [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the path-operation documentation.

---

## Phase 6: Reconcile explicit import

### Problem

Import currently treats existing runtime metadata as proof that an identity is runtime-owned, splits preparation between root and runtime walks, and does not fully reconcile host changes on reimport. Promise publication still asserts physical shape and writability before normal runtime-owned writeback even though the mirror owns the logical version.

### Design

Complete Promise publication and mirror presence together. A resolver always advances its live mirror. Write the resolved value back only when a live runtime-owned physical placement remains an own enumerable writable data property; imported storage and another unsuitable representation remain unchanged. Delete `assertCanPublishPromiseProperty`; Phase 2A already removed value-derived attribution from its failures. Mirror creation retains one internal assertion that the captured key was a valid data placement; fallible reflection classifies the boundary before reaching it.

Reads and presence consult a live mirror before physical storage. Language-key enumeration includes every live mirror placement, while conformant physical storage retains its original key position. Host changes to imported storage are reimported before another operation uses it: reconciliation adopts the current physical key order, detaches recorded or mirrored placements that disappeared, and never appends those deleted keys to observable enumeration. This avoids separate order state while preserving the captured version until the explicit reimport transition.

Use one import walk for new and previously imported data:

1. Visit each reached supported identity once.
2. Retain an existing import boundary or mark that identity imported and shared with the current boundary. Registered instances and their state follow the same per-identity rule as other traversable graph data.
3. Stop at a Function, Error, or opaque identity without enumerating its properties or hidden state.
4. Reconcile the union of the container's current physical language keys, previously indexed placement keys, and live mirror keys. Current physical data keys define observable order. Reuse an unchanged imported Promise version, replace a displaced version at the current program position, and publish an ordinary deletion transition for any recorded or mirrored placement that disappeared. Only current physical data properties contribute children to recurse into.
5. Recurse into every currently available supported child and apply the same admission before publishing a Promise fulfillment.

Treat each external enumeration and descriptor lookup as its own admission boundary. A throwing Proxy trap returns the Phase 2A language Error for the imported branch. Ordinary non-placements are ignored without invoking them. Registered-state validation belongs to Phase 5 invocation, not import. Do not wrap the whole import transition and accidentally convert an internal reconciliation failure into data.

Import never infers runtime origin from metadata, mirrors, indexes, leases, or ArrayView attachment. Host-call result admission may instead recognize identities deliberately supplied to host code; it applies their category policy and imports every new host identity.

Retain the source Promise identity on an imported property's mirror so reimport
can distinguish an unchanged physical placement after settlement. This is
property-version state, not import state, and an unchanged placement gains no
second resolver.

Reconcile indexed properties through the ordinary old-to-new edge transition. Each indexed placement retains only its last published logical value; the existing `cycleCuts` entry already is its previous cut state. Runtime publication and external reconciliation update the value record and ordinary cut state together. This preserves reverse parents and Promise, Error, and cycle-cut totals after the host changes a physical property without maintaining a second cut flag. Unindexed containers need no parallel snapshot.

Introduce one ArrayView-family detachment mechanism here. Give every family a single-purpose mutable backing reference shared by its views. When an attached raw Array is imported at any reached position, copy its backing to runtime-owned storage, retarget the family once, and remove the attachment from the imported Array. Earlier views retain their bounds and property versions; no mirror moves to or is merged through the family backing reference. This is not Phase 0's deleted prepend storage: it has no base index, moving window, or prepend behavior.

Delete runtime-island detection, `promoteRoot`, the separate runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, and the root/result preparation split. Phase 2A already made an explicit retry revisit a partially admitted root; the unified walk extends that rule into bounded reconciliation of every reached identity. Unmarked assignment values remain local runtime data.

### Verification

- Existing metadata, mirrors, indexes, leases, or ArrayView attachment never prevent explicit import.
- Cycles, aliases, nested and root Promises, rejection, and opaque leaves import without modifying the graph.
- A direct alias becomes imported in either traversal order.
- Reimport reaches current children once, reconciles added, replaced, and deleted indexed and unindexed placements, and retains the first boundary.
- External deletion of an indexed ordinary or Promise property is found through the recorded-key union even though the key is absent from current enumeration. Reimport detaches it before subsequent graph access.
- Reads, presence checks, and enumeration agree on every live mirror placement; current physical keys determine order after reimport.
- An unchanged Promise placement keeps one mirror and resolver; a changed placement gets a fresh version at the import position.
- Indexed reconciliation reuses the existing cycle-cut state and stores no duplicate cut flag.
- Registered instances and nested state are reconciled as ordinary traversable identities; import creates no registered ownership unit or special validation pass.
- Import of an attached Array at any reached position moves every earlier view to runtime-owned backing without moving or merging its mirrors, using the shared family reference without per-access metadata lookup.
- Imported Promise settlement remains mirror-only. Runtime-owned settlement also remains logical when physical writeback is unavailable.
- Ordinary accessors and non-enumerable properties are ignored without invocation. Throwing Proxy reflection poisons import, while reconciliation invariants remain fatal.

Update [`runtime-spec.md`](runtime-spec.md), [`import-preparation.md`](import-preparation.md), [`enter.md`](enter.md), and [`array-view.md`](array-view.md).

---

## Phase 7: Enable ordered opaque mutations

### Problem

Opaque identities were originally observation-only. Explicit mutation of their ordinary or hidden host state is a new capability: it must operate on the exact object, so copy-on-write cannot isolate aliases and imported-data protection needs its deliberate exception. Fully serializing every operation would preserve order but would also make independent observations wait for one another.

Property access and host calls must share the same ordering state. Otherwise a pending write can be bypassed by a method call, an opaque argument can be mutated while host code retains it, or a pending observation can overlap a later mutation through another alias.

### Design

Treat each opaque identity as one exact external resource. Its aliases deliberately observe the same mutations. Do not traverse, copy, or materialize it; mutations made through independently retained host references remain outside Cascada's ordering guarantees.

Use one per-identity operation gate for property accesses and every host call that receives the identity as an exact receiver or argument. One host operation contributes at most one entry per opaque identity; a designated mutating receiver makes that entry a mutation, while every other use is an observation.

Reserve an opaque identity's entry as soon as that identity is available from the operation's captured version, before further preparation or invocation. Thus `db.write(1); db.read()` reserves the read behind the write even when the write must still prepare input. If the receiver version itself is pending, its FIFO continuation reserves the resolved identity before later consumers of that version continue.

- An observation waits for the preceding mutation, then runs without waiting for other observations in the same interval. It remains outstanding until its synchronous result completes or its returned Promise settles.
- A mutation reserves its place as soon as its receiver identity is captured, waits for the preceding mutation and every earlier outstanding observation, and blocks every later operation until it completes. Argument or assigned-value preparation is part of that mutation, so later work cannot overtake a pending input.
- Aliases use the same gate. A returned Promise keeps the entry outstanding because the host operation may still be using the identity. Fulfillment, rejection, and a synchronous Error all finish the operation and release the work behind it without changing that operation's own API outcome.

Run ready work synchronously. Register waits through the ordinary Promise helpers at the operation's program position; do not turn an unblocked operation into a Promise, add a microtask hop, or build separate property and method queues.

An opaque property read is a host observation on the exact object. A write resolves and exports its value before touching the object, then performs native property assignment on that exact object, including a native setter. A setter must complete synchronously because JavaScript assignment exposes no returned Promise. A host throw follows Phase 2A's language outcome, while effects already completed on the external object remain visible.

Phase 8 routes opaque method calls through this same gate. An explicitly requested method mutation may change only the exact receiver. Its returned Promise remains the API result and also keeps the mutation outstanding until settlement; observation Promises keep only their own observation outstanding.

### Verification

- Ready opaque property reads and writes remain synchronous.
- Two observations after one mutation wait for that mutation but not for one another; the next mutation waits for both observations.
- Once its receiver is captured, a mutation with a pending assigned value reserves its position before preparing that value, and later access cannot overtake it.
- Property reads and writes share one gate through every alias; Phase 8 reuses it rather than adding method-specific ordering.
- An opaque identity used several times in one host call contributes one gate entry; a mutating receiver takes precedence over its read-only argument aliases.
- Fulfilled and rejected observation and mutation Promises release exactly the operations that depend on them while preserving their API outcomes. A rejection delays but does not poison later operations.
- Imported and multiply referenced opaque identities mutate the exact object deliberately; no copy, traversal, or ownership mark creates a second resource.
- Native getters and setters run only after ordered preparation. A setter throw poisons the targeted Cascada placement or root and returns the same Error; completed effects on the exact external identity remain visible through other aliases.
- Host mutation outside Cascada is not presented as ordered with runtime operations.

Update [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the path-operation documentation.

---

## Phase 8: Dispatch methods by data type

### Problem

Method dispatch still preserves the legacy capabilities of the tracked/untracked split even after it consumes admitted types: inherited record methods can execute, own record functions are rejected, instances of unregistered classes are rejected, and Array overrides receive only shallow-materialized views. The Array-specific mutation flag is also validated before the receiver category is known.

### Design

Implement the `AGENTS.md` capability table directly. Treat `run`'s Boolean as the requested operation mode, rename its internal `mutateArray` terminology without changing the positional API, and validate the mode only after classifying the resolved receiver and selected callable. A class or record function named `push` is not an Array mutator.

Prepare the receiver and each explicit argument only to the extent selected by the receiver category and method. Host calls export and therefore consume every argument; controlled methods leave retained payloads untouched. Continue all required preparation after finding an Error. Snapshot-bound inputs first copy into one private graph without deciding the call outcome. Once required preparation is ready, inspect roots synchronously in receiver-then-argument order and append each distinct consumed Error to one ordered list. Settlement order cannot affect that list, and order within one composite input is not semantic. Return one Error unchanged; for several, return an Error whose `errors` array contains the originals. An Error nested inside composite data participates only when the receiver category's preparation or the operation's behavior reaches it.
Use the Error-combination utility established in Phase 2B; call preparation only owns discovery order.

Once the receiver version is available, method selection follows admitted type:

- a logical Array first selects a supported standard method or an observation-only override;
- a string selects a native observation on the primitive;
- a record captures and resolves only the selected own language-property version; it never searches the prototype or exposes the record as callable state;
- an instance of a registered class reuses Phase 5's admitted class-chain descriptor selection; and
- an opaque instance selects an observational or explicitly requested mutating method on its exact identity.

An own enumerable data placement shadows a non-record method and is not executable. Ordinary record and Array accessors are non-placements and are never invoked or treated as overrides. Capture the selected descriptor before preparing arguments. Only a registered-class or opaque accessor declared executable by its receiver category may run, and only after preparation is otherwise clean; its failure becomes the call's language Error. Reflection, missing, shadowing, and non-callable failures enter the receiver position of the ordered Error list while argument preparation still completes.

Constructors remain unsupported. A descriptor lookup or supported executable getter that throws becomes a language Error. An Error produced by resolving a record function property or returned by an executable getter propagates unchanged; another non-callable value, or a supported accessor without a getter, produces the existing validation Error. Call preparation must not turn these outcomes into fatal runtime failures.

Prepare every call as one ordered transition:

1. Capture the requested mode, receiver path, method key, and explicit argument values at the operation's program position. Start receiver-path traversal and registration first; capture each placement when reached.
2. Once the receiver is available and non-Error, capture its category and selected method-property, callable, or accessor descriptor before that transition yields, without invoking an executable getter. Then copy one complete native Array snapshot for an override, prepare the Phase 5 registered-receiver snapshot, reserve the Phase 7 opaque-identity entry, lease another exact observational receiver, or retain the controlled runtime receiver.
3. Start required argument preparation from left to right without short-circuiting after an Error. Snapshot traversal captures each nested property version when it reaches that placement. Host-bound positions consume every argument and share the receiver's private copy context, preserving aliases and cycles across all positions and leasing every exact runtime-managed identity that cannot be copied. Each exact opaque identity captured in those positions enters the Phase 7 gate once for the operation; a mutating receiver dominates its argument aliases. Controlled positions resolve only data the method consumes; retained payloads remain exact Errors or Promises.
4. Once required preparation is ready, inspect prepared inputs synchronously in receiver-then-argument order, beginning with any receiver-selection Error. Within each input, track visitation separately for Phase 5's ordinary-input and registered-state policies, and use one shared seen-Error set to append each distinct consumed Error once. If the list is non-empty, do not invoke an executable getter, callback, method, override, or mutator. An observation returns the single original or ordered aggregate and leaves its receiver unchanged. A mutation replaces its targeted receiver placement or root with that poison and exposes the same poison through the API, directly or through pending operation work.
5. Otherwise invoke the selected operation exactly once and synchronously. Controlled runtime code follows its method-specific logical transition. Host code follows its declared boundary. Registered methods and accessors delegate snapshot invocation, validation, publication, and published-receiver leasing to Phase 5. For other host mutations, a synchronous throw poisons the targeted receiver and becomes the API Error; an observation throw affects only the result. A returned Promise remains the API result with its original fulfillment and rejection; an opaque Promise keeps the Phase 7 gate entry outstanding until settlement.
6. Complete the call using known origins. Admit a direct result before returning it. For a Promise result, register one internal FIFO observer that admits fulfillment and performs cleanup without replacing the result or changing rejection. Apply Phase 5's result-origin rule to a registered mutation. Otherwise keep controlled runtime results runtime-owned, import new host and snapshot identities, and preserve the origin of exact receivers, opaque arguments, and Functions supplied without snapshotting. After direct admission, fulfillment, rejection, or synchronous failure, release exactly the leases and Phase 7 entries acquired for that call.

The coordinator owns sequencing, snapshot identity, result admission, and cleanup; category dispatch owns receiver policy and contributes the leases or opaque entries its boundary requires. Use one local operation state for copies, waits, and idempotent resource release, followed by one synchronous Error-inspection state. Do not infer resource lifetime from a generic observation result or add a persistent coordinator, queue, or parallel preparation path.

Controlled method preparation contributes every nested Error it actually reaches at the receiver position before dependent mutation or callback work runs. Structure-only methods do not inspect nested values merely to search for Errors.

Controlled receiver protection ends when controlled code no longer needs that receiver, not whenever its independent result settles. Pending argument preparation leases the captured receiver until invocation. A method that returns pending work and later reads the receiver owns a method-local lease; a method whose result has already captured all required property versions owns none. Host calls instead retain only the category-specific resources supplied to them, through synchronous completion or returned-Promise settlement.

Extend Phase 5's copier into the one multi-root snapshot engine. Public export, registered receivers, Array override receivers, and host-call arguments share its source-to-copy map and recursive readiness, so aliases and cycles remain shared across receiver and argument positions. The map also identifies copied nodes; do not add another copy-walk visited set. The private graph may temporarily contain terminal Errors and exact leaves, but host code receives it only after ordered synchronous inspection succeeds. Public export normalizes registered instances to plain data, while host-call snapshots preserve their admitted prototypes; keep that concrete container distinction without adding a general policy layer. Registered observations and mutations differ only in whether the same prepared receiver is discarded or published. Other controlled runtime methods bypass the engine because they consume Cascada values and nested data selectively. Do not introduce another graph copier.

Registered execution retains Phase 5's observation, mutation, result-origin, and retention contracts. An opaque observation may read ordinary and hidden state but must not mutate its exact receiver; an explicit opaque mutation may change only that receiver and follows Phase 7 ordering. Host code may retain an exact unsnapshotted receiver, opaque argument, or Function only through its returned value or until its returned Promise settles. Other traversable exact values are leased and opaque identities keep their Phase 7 entries for that interval; detached retention is unsupported. A record function is invoked without the record as its receiver; it may use explicit arguments and read-only host state, but cannot read or mutate its containing record or other Cascada graph state.

Keep executable Function positions explicit. The current controlled callback position is the `sort`/`toSorted` comparator: it receives settled logical elements, is synchronous, read-only, and non-retaining, and a Promise result remains unsupported. Supported String native protocols and callbacks execute inside their host boundary. Passing a Function as ordinary data does not authorize another runtime path to invoke it.

Reject Array mutators in observation mode and mutations through Array overrides. Delete unreachable observation-mutator handling, but keep observation view dispatch: `concat` may extend eligible runtime backing while its receiver retains fixed bounds.

Do not add sharing or lease guards that forbid otherwise safe ArrayView backing reuse. An imported Array never attaches or serves as mutable backing; ordinary import attribution makes the operation materialize or COW first.

Delete ordinary receiver selection through `requiresArrayMaterialization`, its `receiver === targetValue` lease inference, and `invokeObservationMethodWithExportedArgs`'s independent per-argument exports. The coordinator becomes the sole collector of Errors reached by the selected preparation. Array overrides always export; exact observational receivers lease explicitly by category. Keep `requiresArrayMaterialization` where representation mutation and copy-on-write still need it.

Preserve the host-call error boundary: a synchronous host-method, executable getter, or reflection throw becomes a ready Error result, and a mutating-function throw also poisons its targeted receiver. A returned Promise preserves its own fulfillment and rejection without retroactive graph poisoning. Property and value failures follow Phase 2A's publication rule; bookkeeping, impossible-transition, and declared host-contract violations remain fatal.

### Verification

- Every data type accepts only the methods and modes in `AGENTS.md`.
- A ready call invokes and returns synchronously.
- A host call waits for every explicit argument, while a controlled method waits only for consumed inputs; neither short-circuits the preparation it requires after an earlier Error.
- One consumed input Error is returned unchanged. Several produce an aggregate containing every original Error in receiver-then-argument order, including mixed ready and pending Errors even when their Promises settle in another order. Pending preparation fulfills with the same outcome.
- A descriptor or non-callable selection Error combines ahead of argument Errors; an executable getter is not invoked after preparation is poisoned.
- An Error obtained from the selected record property or executable getter propagates unchanged instead of being replaced by a non-callable validation Error.
- Nested Errors remain data until required preparation or method behavior reaches them; every Error reached by one call appears once in that call's poison result.
- A controlled method that consumes several Error elements, such as sort preparation, returns their aggregate without invoking its comparator; a structure-only method leaves uninspected nested Errors as data.
- A mutation poisoned before invocation replaces its targeted receiver placement or root with the same single or aggregate Error returned through the API.
- A record function waits for its captured property version, receives exported arguments, is not called with the record as `this`, and cannot observe record state; inherited and non-callable selections fail.
- Array mutators requested as observations and mutations through Array overrides fail, while a same-named record or class function still follows its own category.
- Supported standard Array methods retain controlled behavior and resolve only the properties each method consumes; unsupported native methods remain rejected unless explicitly overridden.
- Retaining methods such as `push` store an Error or rejecting Promise as payload without poisoning the call; consuming methods such as `concat` propagate either as call poison. A retained rejection later poisons only its property version.
- Array overrides receive complete exported native Arrays containing no ArrayView, unresolved language property, or original traversable graph identity.
- Receiver and argument preparation uses one operation state, preserves aliases and cycles across positions, and cannot be changed by later Cascada mutation.
- Public export and host calls use one multi-root snapshot engine; receiver and argument aliases share one exported identity, registered host arguments retain their prototypes, and public export remains plain data.
- Controlled runtime results remain runtime-owned, while identities first produced by host code are imported.
- Registered-class observations and mutations see only settled host-ready state and preserve imported or prior owners.
- Imported and runtime-owned Promises inside registered state use the same captured mirror path; imported physical storage remains unchanged.
- A registered-class mutation publishes its complete synchronous private receiver before any returned Promise settles and leases that receiver until settlement.
- Opaque observations and explicit mutations receive the exact identity and use Phase 7 ordering through every alias.
- Opaque property accesses and method calls use the same gate; neither path can bypass the other.
- A pending host result leases each exact traversable argument and keeps every opaque receiver or argument in the Phase 7 gate until settlement. Opaque observations may overlap, while later mutation waits for every preceding use; all leases and gate entries are released on fulfillment or rejection.
- A controlled method with pending arguments sees its captured receiver, an independent controlled result does not extend the receiver lease, and a controlled method that continues reading after returning pending work protects only that remaining interval.
- `Date.prototype.getTime` succeeds as an observation. `Date.prototype.setTime` succeeds only as an explicit mutation, and an observation-mode request leaves the Date unchanged.
- Strings retain native observational behavior.
- Record functions may observe read-only host state such as time, but cannot read or mutate their containing record or other Cascada graph state.
- Own enumerable data state shadows non-record methods. Ordinary graph accessors remain absent and uninvoked; constructor, missing-getter, non-callable, and throwing supported descriptor/accessor cases retain their specified classification.
- The receiver path and explicit argument values are captured at issue time with receiver registration first; the receiver placement and nested property versions are captured as preparation reaches them. A ready receiver's callable or accessor is captured before category-specific argument preparation, without invoking executable host code early.
- An Array override returning `this` yields its imported exported snapshot. A registered mutation result may contain the published receiver or its state at any depth; identities in the final validated receiver retain runtime origin and normal sharing applies.
- A registered mutation result containing both published state and host-created data preserves origin per identity. Admission stops at published identities without reimporting their graphs; a piece removed from the private receiver is imported.
- A registered observation returning its receiver snapshot or state imports that snapshot rather than exposing the original graph value.
- An exact unsnapshotted receiver, opaque argument, or Function returned directly, through a Promise, or inside another result retains its origin and accounts for any additional owner.
- Other new direct and fulfilled results are imported immediately.
- A synchronous observation throw returns an Error without changing its receiver. A synchronous mutating-function throw poisons its targeted receiver and returns the same Error; partial physical effects on an exact opaque identity remain visible through other aliases. A returned Promise preserves its fulfillment or rejection and does not retroactively poison the receiver.
- Runtime invariant and bookkeeping failures remain fatal across the same call paths.
- Promise interleavings preserve receiver-before-argument registration and FIFO transitions.
- Valid `concat`, `push`, indexed growth, and length growth still reuse runtime-owned backing without changing earlier logical values.
- Imported Arrays never acquire ArrayView attachment or act as mutable backing, and their physical storage remains unchanged.

Update [`run.md`](run.md), [`array-view.md`](array-view.md), [`data-classes.md`](data-classes.md), and [`runtime-spec.md`](runtime-spec.md).
