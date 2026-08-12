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
- An instance of a registered class and its complete semantic state graph form one ownership and Promise-gating unit. A mutation always prepares a fresh private whole-unit copy, and state identities never acquire an owner outside that unit.
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
- Aliases and cycles inside one ownership unit do not change later mutation strategy. Real additional owners, leases, and import retain their existing protection.

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

## Phase 5: Make instances of registered classes atomic

### Problem

Instances of registered classes are currently traversed and copied like ordinary containers. A property may therefore be published independently, host class code can receive unresolved or internal state, and protecting the receiver root does not protect state identities that are independently shared.

Implement and review 5A before 5B. The unit transition is independently useful and must be settled before accessor execution builds on it.

### Design — 5A. Atomic unit preparation and ownership

The first instance of a registered class crossed from ordinary graph data is the root of one registered-class unit. Its complete semantic state graph belongs to that unit; a nested registered instance does not start another unit. Placements inside the unit remain graph edges for traversal, indexing, and Error queries, but never become independent owners.

Assign each mutable identity in the unit one permanent `unitRoot`, with the root pointing to itself. The mark validates later encounters: an identity cannot belong to another unit, and a non-root state identity cannot acquire an independent owner outside it. It is not ownership, COW, or path state; ordinary walks carry the enclosing unit while traversing it, and mutation still publishes through the root's containing placement. Primitives and immutable Error identities need no mark. Retaining the root records normal sharing, but mutation ignores that fact because it always publishes a fresh private unit.

Extend the existing raw graph-copy walk into the one copy engine used for registered-unit preparation and host snapshots. One operation-wide source-to-copy map preserves admitted prototypes, aliases, cycles, logical Array contents, holes, and Error identities. The engine copies graph structure; callers own origin, admission, and publication. The walk resolves every Promise reached in semantic state and converts rejection to the Error value at that state position. Each source Promise placement keeps its ordinary mirror; the private destination receives only the resolved logical value. A unit becomes logically available only after this complete required state is ready, so a runtime-owned published unit contains no pending semantic-state version. Imported physical Promise properties remain unchanged while their mirrors supply the logical values. Phase 8 extends this same engine to multi-root host preparation rather than adding another graph copier.

If preparation waits, keep the working copy private and install one ordinary Promise gate at the unit's containing placement, never inside its state. A later mutation prepares its own fresh unit from the preceding published result rather than sharing an earlier private copy. The existing mirror-liveness check prevents detached preparation from overwriting a later replacement or deletion.

Every mutation inside a registered unit uses a fresh fully prepared prototype-preserving copy, including direct assignment, deletion, mutating `enter`, controlled Array mutation within state, class-defined setters, and later registered methods. Apply the requested change to that private copy, validate and admit its complete final state in one walk, build a missing index with the existing indexer when the source unit was indexed, and publish the copy once at the containing placement. Both passes are bounded by the atomic value being produced; do not reconcile mutations against the old unit or duplicate the indexer's cycle logic. Private unit storage is normal writable runtime storage, so it needs none of the ordinary representation-fallback path. Never mutate the previously published unit in place. This single path removes conditional whole-unit COW, pre-call edge snapshots, separate in-place versus protected pipelines, and registered-unit leases.

The same copy engine handles state crossing with caller-specific map scope. Copy-in reuses the current unit's source-to-copy map, so state already in the source maps to the corresponding private identity and preserves aliases and self-cycles. Copy-out starts a fresh map and admits an independent value or unit. Thus external mutable values assigned into state and mutable descendants exposed outside it—including nested registered instances—never cross by identity. Do not add a transfer optimization: retagging a complete transferred graph costs the same walk and makes unit membership mutable. Only retaining the enclosing root adds another owner and shares the unit.

Registered-class semantic state may contain primitives, Errors, records, logical Arrays, and nested registered instances. Own accessors, Functions, and opaque identities cannot be isolated and are invalid state. Classify failure at the boundary that introduced it:

- an Error or rejected Promise directly assigned to an ordinary state placement becomes that placement's value and does not poison the unit;
- an unsupported value supplied by a language assignment is an invalid logical input, so the failed transition poisons the containing unit and returns the same Error when ready;
- invalid state found in an imported or initially supplied registered instance, or left by registered host code, violates the registration contract and is fatal before publication; and
- an Error consumed while preparing a setter or mutating method prevents invocation and poisons the containing unit, while receiver Errors consumed by an observation affect only its result.

Preparation of a host receiver consumes the complete semantic state graph. Continue after an Error to collect every distinct Error reached by that one composite receiver. Use Phase 2B's aggregation rule and never invoke registered host code with poisoned state.

Every graph boundary treats the unit root as the only ownership, transition, and extraction boundary. Extracting a mutable descendant copies it out; read-only `enter` retains its captured unit without a lease because later mutation replaces it; Error queries and indexing may traverse state without adding owners.

The current import walks begin carrying and recording the enclosing unit in this phase. They mark only the unit root imported and shared, prepare its state without modifying imported storage, and treat a mutable identity that also occurs outside or in another unit as invalid imported state. Promise preparation inside imported state receives the carried root boundary directly; it does not infer writeback permission from descendant metadata or copy the import boundary onto those descendants. Unit membership alone is not independent runtime ownership, so exclude `unitRoot` from the temporary `hasOperationalMetadata` inference until Phase 6 deletes that inference. Phase 6 keeps this end-state context while replacing the remaining split import traversal; do not introduce a temporary registered-class import walk.

Introduce the complete ArrayView-family detachment mechanism here because an imported registered unit may contain an Array already used as backing. Give each family one single-purpose mutable backing reference shared by all its views. Views do not retain their derived children, so enumerating a family would require either retaining every view or adding WeakRef machinery; the shared reference instead retargets the family atomically without a registry or per-access metadata lookup. When registered-unit import reaches such an Array, detachment copies the backing to runtime-owned storage, updates the reference once, and removes the attachment from the imported Array; view-local bounds and mirrors stay where they are. This is not Phase 0's deleted prepend storage: it has no base index, moving window, or prepend behavior. Phase 6 invokes the same mechanism for direct Array import.

### Design — 5B. Class-defined accessors

Select registered accessors from the prototype recorded at admission, never from a later physical prototype. Use one class-chain descriptor primitive that walks up to but excludes `Object.prototype`; Phase 8 reuses it for registered methods. Capture the descriptor before asynchronous preparation. An own enumerable data placement is state and shadows the registered surface.

- Reading a getter prepares an isolated, fully ready registered-unit snapshot and invokes the getter once. Its result crosses the ordinary host-result admission boundary; mutation of the published unit is impossible because host code never receives it.
- Reading a setter-only accessor produces `undefined`. Assigning through a getter-only accessor produces the Phase 2A language Error.
- Assigning through a setter exports its one assigned value, prepares the fresh private unit copy, and invokes the setter once on the corresponding receiver. Receiver Errors precede assigned-value Errors in aggregation. Any poison skips invocation and replaces the containing unit.
- A setter must finish synchronously. A synchronous throw poisons the containing unit and returns that Error; a thenable setter result is a fatal registered-class contract violation because JavaScript assignment has no asynchronous result to coordinate.
- Deletion and an assignment not handled by a class accessor follow Phase 2A's ordinary placement rules: inherited accessors are not placements, and a missing key becomes an own data placement without consulting the prototype chain.

Later registered-method mutation uses the same private unit preparation, receiver correspondence, validation, and publication primitive. A normal synchronous method throw poisons the containing unit and leaves the private partial copy unreachable. A returned Promise remains only the independent API result, preserves its fulfillment and rejection, and never authorizes mutation after the synchronous call returns.

### Verification

- Ready unit preparation, copying, mutation, and publication complete synchronously.
- A Promise anywhere in initial, imported, or assigned semantic state keeps the complete unit unavailable behind its containing-placement gate. Later access to any part resumes in FIFO order after complete preparation.
- Source Promise placements retain their ordinary mirrors, while the private and published unit contains only resolved state. Imported physical Promise properties remain unchanged.
- Two Promise placements resolving to the same mutable identity become one private identity inside the prepared unit. A preserved source unit and its copy never share that mutable result.
- Every mutation publishes a fresh unit and leaves imported, shared, and singly owned prior units unchanged. A registered instance below a shared or leased ordinary ancestor is likewise preserved.
- Two ordinary placements of one unit retain the same old unit; mutation through either publishes a new unit only at its targeted placement.
- A whole-unit copy preserves the admitted root and nested prototypes, aliases, self-cycles, Array holes and contents, and Error identities. The copied self-cycle points to the copy, not the source.
- Same-unit assignment maps source state to its corresponding private copy and preserves aliases. An ArrayView or external runtime graph assigned into state is copied in; every mutable descendant extracted through `lookupPath`, `readPath`, `enter`, or a host result is copied out.
- A nested registered instance belongs to the outer unit. Extracting it creates an independent unit, while retaining the enclosing root shares only that root unit.
- The root records itself as unit root, every mutable state identity records that same root, and no state identity is retagged or transferred across a unit boundary.
- Direct assignment of an Error or rejecting Promise stores that Error in state. Poison consumed by a setter or method skips invocation and poisons the whole unit. Invalid language input poisons, while invalid initial, imported, or host-produced state is fatal before publication.
- Reassignment, replacement, and deletion cannot be overwritten by detached preparation. Fatal preparation exposes no private or unexported state.
- Assignment, deletion, mutating and read-only `enter`, nested Array mutation and length change, Promise publication, lookup, read, export, Error queries, and indexing all honor the same unit boundary.
- Pending read-only `enter` retains the captured unit without a lease; a later mutation publishes a fresh unit and cannot change that captured version.
- Indexed units retain correct Promise, Error, cycle-cut, and reverse-parent state after complete replacement. Final validation and admission share one traversal; the existing indexer builds the new unit without reconciling mutations against the old one.
- A getter observes one fully ready isolated snapshot. Receiver Errors aggregate without invoking it; its throw affects only the result.
- A setter receives one fully resolved exported value and runs once on the same fresh private unit used by method mutation. Receiver and value Errors aggregate in order and skip it.
- Setter preparation captures the receiver first and registers all unit-state dependencies before the assigned value's dependencies.
- A pending setter value gates the complete unit. A setter throw poisons it, and a thenable setter result is fatal without publishing the private copy.
- Accessor selection uses the admitted prototype. Own state shadows class accessors; a setter-only accessor reads as `undefined`; getter-only assignment produces its language Error; invalid own accessor state is rejected at unit preparation; deletion does not invoke inherited accessors; and a missing key becomes an own data placement without invoking `Object.prototype.__proto__`.
- Registering a concrete class exposes methods and accessors from its captured prototype and inherited class chain up to, but excluding, `Object.prototype`; later replacement of the instance's physical prototype does not change the selection root.
- Importing a registered unit containing an attached Array moves every existing view in the family to runtime-owned backing. Mutating a retained view or the imported unit cannot modify the imported Array.
- Registered-method additions, replacements, and deletions are admitted from the private final unit. A synchronous throw leaves that copy unreachable; a returned Promise neither delays unit publication nor authorizes later mutation.
- The current tests that share a mutable Promise result across class copies and point a copied self-cycle at the source are replaced with atomic-unit expectations. The existing class-defined prototype-setter test is likewise replaced while retaining its ordinary-record and inherited-non-accessor cases.

Update [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`enter.md`](enter.md), [`array-view.md`](array-view.md), and the path-operation documentation.

---

## Phase 6: Reconcile explicit import

### Problem

Import currently treats existing runtime metadata as proof that an identity is runtime-owned, splits preparation between root and runtime walks, and does not fully reconcile host changes on reimport. Promise publication still asserts physical shape and writability before normal runtime-owned writeback even though the mirror owns the logical version.

### Design

Complete Promise publication and mirror presence together. A resolver always advances its live mirror. Write the resolved value back only when a live runtime-owned physical placement remains an own enumerable writable data property; imported storage and another unsuitable representation remain unchanged. Delete `assertCanPublishPromiseProperty`; Phase 2A already removed value-derived attribution from its failures. Mirror creation retains one internal assertion that the captured key was a valid data placement; fallible reflection classifies the boundary before reaching it.

Reads and presence consult a live mirror before physical storage. Language-key enumeration includes every live mirror placement, while conformant physical storage retains its original key position. Host changes to imported storage are reimported before another operation uses it: reconciliation adopts the current physical key order, detaches recorded or mirrored placements that disappeared, and never appends those deleted keys to observable enumeration. This avoids separate order state while preserving the captured version until the explicit reimport transition.

Use one import walk for new and previously imported data:

1. Visit each reached supported identity once, carrying its enclosing registered-class unit. Reuse and validate an already recorded unit root instead of deriving membership again.
2. Outside a registered-class unit, retain an existing import boundary or mark the identity imported and shared with the current boundary. An instance of a registered class starts one imported unit. Only its root stores the import boundary and sharing state; descendants use the carried root boundary for preparation without acquiring independent import or ownership state.
3. Stop at a Function, Error, or opaque identity without enumerating its properties or hidden state.
4. Reconcile the union of the container's current physical language keys, previously indexed placement keys, and live mirror keys. Current physical data keys define observable order. Reuse an unchanged imported Promise version, replace a displaced version at the current program position, and publish an ordinary deletion transition for any recorded or mirrored placement that disappeared. Only current physical data properties contribute children to recurse into.
5. Recurse into every currently available supported child and apply the same admission before publishing a Promise fulfillment.

Treat each external enumeration and descriptor lookup as its own admission boundary. A throwing Proxy trap returns the Phase 2A language Error for the imported branch. Ordinary non-placements are ignored without invoking them; invalid registered-class state remains the Phase 5 registration-contract failure. Do not wrap the whole import transition and accidentally convert an internal reconciliation failure into data.

Import never infers runtime origin from metadata, mirrors, indexes, leases, or ArrayView attachment. Host-call result admission may instead recognize identities deliberately supplied to host code; it applies their category policy and imports every new host identity.

Retain the source Promise identity on an imported property's mirror so reimport
can distinguish an unchanged physical placement after settlement. This is
property-version state, not import state, and an unchanged placement gains no
second resolver.

Reconcile indexed properties through the ordinary old-to-new edge transition. Each indexed placement retains only its last published logical value; the existing `cycleCuts` entry already is its previous cut state. Runtime publication and external reconciliation update the value record and ordinary cut state together. This preserves reverse parents and Promise, Error, and cycle-cut totals after the host changes a physical property without maintaining a second cut flag. Unindexed containers need no parallel snapshot.

The unified walk invokes Phase 5's ArrayView-family detachment when an attached raw Array is imported directly and preserves its use inside registered units. Late explicit import transitions the raw Array identity to its current external contents, while earlier views retain their bounds and property versions on the detached runtime backing. No mirror moves to or is merged through the family backing reference.

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
- Registered state is traversed for preparation and indexing without giving descendants independent ownership.
- Direct import of an attached Array moves every earlier view to runtime-owned backing without moving or merging its mirrors. The unified walk also preserves Phase 5's registered-unit case and uses the shared family reference without per-access metadata lookup.
- Imported Promise settlement remains mirror-only. Runtime-owned settlement also remains logical when physical writeback is unavailable.
- Ordinary accessors and non-enumerable properties are ignored without invocation. Throwing Proxy reflection poisons import, invalid registered-class state is fatal at the registration boundary, and reconciliation invariants remain fatal.

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

Prepare the receiver and each explicit argument only to the extent selected by the receiver category and method. Host calls export and therefore consume every argument; controlled methods leave retained payloads untouched. Continue all required preparation after finding an Error. Collect every distinct original Error consumed by that preparation in receiver-then-argument order, independent of settlement order. Use one bucket for receiver resolution and selection, then one for each consumed explicit argument; order within one composite input is not semantic. Return one Error unchanged; for several, return an Error whose `errors` array contains the originals. An Error nested inside composite data participates only when the receiver category's preparation or the operation's behavior reaches it.
Use the Error-combination utility established in Phase 2B; call preparation only owns discovery order.

Once the receiver version is available, method selection follows admitted type:

- a logical Array first selects a supported standard method or an observation-only override;
- a string selects a native observation on the primitive;
- a record captures and resolves only the selected own language-property version; it never searches the prototype or exposes the record as callable state;
- an instance of a registered class reuses Phase 5's admitted class-chain descriptor selection; and
- an opaque instance selects an observational or explicitly requested mutating method on its exact identity.

An own enumerable data placement shadows a non-record method and is not executable. Ordinary record and Array accessors are non-placements and are never invoked or treated as overrides. Capture the selected descriptor before preparing arguments. Only a registered-class or opaque accessor declared executable by its receiver category may run, and only after preparation is otherwise clean; its failure becomes the call's language Error. Reflection, missing, shadowing, and non-callable failures occupy the receiver Error bucket while argument preparation still completes.

Constructors remain unsupported. A descriptor lookup or supported executable getter that throws becomes a language Error. An Error produced by resolving a record function property or returned by an executable getter propagates unchanged; another non-callable value, or a supported accessor without a getter, produces the existing validation Error. Call preparation must not turn these outcomes into fatal runtime failures.

Prepare every call as one ordered transition:

1. Capture the requested mode and the receiver, method-property, and argument versions at the operation's program position.
2. Start receiver-version preparation first. Once that value is available and non-Error, capture its category and callable or accessor descriptor without invoking an executable getter. Then export one complete native Array snapshot for an override, use the registered-class observation snapshot or fresh private whole-unit mutation transition, reserve the Phase 7 opaque-identity entry, lease another exact observational receiver, or retain the controlled runtime receiver.
3. Capture every explicit argument version from left to right when the call is issued. Once receiver selection determines the boundary, start every required argument preparation without short-circuiting after an Error. Host-bound positions consume every argument and share one snapshot context that preserves aliases and cycles across the receiver and arguments and leases every exact runtime-managed identity that cannot be copied. Each exact opaque identity captured in those positions enters the Phase 7 gate once for the operation; a mutating receiver dominates its argument aliases. Controlled positions resolve only data the method consumes; retained payloads remain exact Errors or Promises.
4. If preparation consumed any Errors, do not invoke an executable getter, callback, method, override, or mutator. An observation returns the single original or ordered aggregate and leaves its receiver unchanged. A mutation replaces its targeted receiver placement or root with that poison and exposes the same poison through the API, directly or through pending operation work.
5. Otherwise invoke the selected operation exactly once and synchronously. Controlled runtime code follows its method-specific logical transition. Host code follows its declared boundary. A synchronous mutating-function throw poisons the targeted receiver and becomes the API Error; an observation throw affects only the result. Validate, admit, index when required, and publish a successful registered-class mutation's complete ready private unit through Phase 5's transition. A returned Promise remains the API result with its original fulfillment and rejection. It needs no registered-unit lease because every later registered mutation publishes another fresh unit; an opaque Promise still keeps the Phase 7 gate entry outstanding until settlement.
6. Complete the call using known origins. Admit a direct result before returning it. For a Promise result, register one internal FIFO observer that admits fulfillment and performs cleanup without replacing the result or changing rejection. A controlled runtime result retains its runtime origin and is not imported merely because it is a method result. Import new host identities and returned snapshot identities created for arguments, Array overrides, or registered-class observations. Preserve the origin of an exact receiver, opaque argument, or Function supplied without snapshotting and account for its additional owner. Preserve and share a registered-class mutation's whole receiver; always copy out mutable state still owned by the unit. After direct admission, fulfilled admission, rejection, or synchronous failure, release exactly the leases and Phase 7 entries acquired for that call.

The coordinator owns sequencing, snapshot identity, result admission, and cleanup; category dispatch owns receiver policy and contributes the leases or opaque entries its boundary requires. Use one local operation state for copies, aliases, cycles, Errors, waits, and idempotent release. Do not infer resource lifetime from a generic observation result or add a persistent coordinator, queue, or parallel preparation path.

Controlled method preparation contributes every nested Error it actually reaches to the receiver bucket before dependent mutation or callback work runs. Structure-only methods do not inspect nested values merely to search for Errors.

Controlled receiver protection ends when controlled code no longer needs that receiver, not whenever its independent result settles. Pending argument preparation leases the captured receiver until invocation. A method that returns pending work and later reads the receiver owns a method-local lease; a method whose result has already captured all required property versions owns none. Host calls instead retain only the category-specific resources supplied to them, through synchronous completion or returned-Promise settlement.

Extend Phase 5's graph-copy engine into one multi-root host snapshot. Public export, registered-class receiver snapshots, Array override receivers, and host-call arguments share its copies map, visited set, readiness tree, and ordered per-input Error buckets, so aliases and cycles remain shared across receiver and argument positions and settlement order cannot reorder Errors. Registered mutations use the same copying engine but keep their private unit under the unit transition; other controlled runtime methods bypass it because they consume Cascada values and nested data selectively. One operation-wide seen set removes duplicate Error identities without determining their order. Do not introduce another graph copier.

Registered-class observations are side-effect-free. A registered-class mutation may change only its fresh private receiver unit during synchronous invocation. It may expose that unit or copies of its state only through its result; asynchronous mutation and detached retention are contract violations. Later mutation publishes another unit, so a returned Promise retaining the published receiver does not require a lease. An opaque observation may read ordinary and hidden state but must not mutate its exact receiver; an explicit opaque mutation may change only that receiver and follows Phase 7 ordering. Host code may retain an exact unsnapshotted receiver, opaque argument, or Function only through its returned value or until its returned Promise settles. Other traversable exact values are leased and opaque identities keep their Phase 7 entries for that interval; detached retention is unsupported. A record function is invoked without the record as its receiver; it may use explicit arguments and read-only host state, but cannot read or mutate its containing record or other Cascada graph state.

Keep executable Function positions explicit. The current controlled callback position is the `sort`/`toSorted` comparator: it receives settled logical elements, is synchronous, read-only, and non-retaining, and a Promise result remains unsupported. Supported String native protocols and callbacks execute inside their host boundary. Passing a Function as ordinary data does not authorize another runtime path to invoke it.

Reject Array mutators in observation mode and mutations through Array overrides. Delete unreachable observation-mutator handling, but keep observation view dispatch: `concat` may extend eligible runtime backing while its receiver retains fixed bounds.

Do not add sharing or lease guards that forbid otherwise safe ArrayView backing reuse. An Array imported directly or as registered-unit state never attaches or serves as mutable backing; an operation uses its carried unit context to materialize or COW first.

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
- Array overrides receive complete exported native Arrays containing no ArrayView, unresolved language property, or original runtime-managed identity.
- Receiver and argument preparation uses one operation state, preserves aliases and cycles across positions, and cannot be changed by later Cascada mutation.
- Public export and host calls use one multi-root snapshot engine; receiver and argument aliases share one exported identity.
- Controlled runtime results remain runtime-owned, while identities first produced by host code are imported.
- Registered-class observations and mutations see only settled host-ready state and preserve imported or prior owners.
- A registered-class mutation publishes its complete synchronous private unit before any returned Promise settles. Later mutation prepares another private unit, so retaining the earlier receiver through the result needs no lease.
- Opaque observations and explicit mutations receive the exact identity and use Phase 7 ordering through every alias.
- Opaque property accesses and method calls use the same gate; neither path can bypass the other.
- A pending host result leases each exact traversable argument and keeps every opaque receiver or argument in the Phase 7 gate until settlement. Opaque observations may overlap, while later mutation waits for every preceding use; all leases and gate entries are released on fulfillment or rejection.
- A controlled method with pending arguments sees its captured receiver, an independent controlled result does not extend the receiver lease, and a controlled method that continues reading after returning pending work protects only that remaining interval.
- `Date.prototype.getTime` succeeds as an observation. `Date.prototype.setTime` succeeds only as an explicit mutation, and an observation-mode request leaves the Date unchanged.
- Strings retain native observational behavior.
- Record functions may observe read-only host state such as time, but cannot read or mutate their containing record or other Cascada graph state.
- Own enumerable data state shadows non-record methods. Ordinary graph accessors remain absent and uninvoked; constructor, missing-getter, non-callable, and throwing supported descriptor/accessor cases retain their specified classification.
- Receiver and argument versions are captured at issue time with receiver registration first. A ready receiver's callable or accessor is captured before category-specific argument preparation, without invoking executable host code early.
- An Array override returning `this` yields its imported exported snapshot. A registered result may contain its whole receiver at any depth; that identity retains its runtime origin and the whole unit becomes shared.
- A registered-class observation returning its receiver snapshot or state imports that snapshot rather than exposing the original unit.
- A registered-state descendant returned while the unit still owns it becomes an independent copy. Removal does not introduce a transfer path.
- An exact unsnapshotted receiver, opaque argument, or Function returned directly, through a Promise, or inside another result retains its origin and accounts for any additional owner.
- Other new direct and fulfilled results are imported immediately.
- A synchronous observation throw returns an Error without changing its receiver. A synchronous mutating-function throw poisons its targeted receiver and returns the same Error; partial physical effects on an exact opaque identity remain visible through other aliases. A returned Promise preserves its fulfillment or rejection and does not retroactively poison the receiver.
- Runtime invariant and bookkeeping failures remain fatal across the same call paths.
- Promise interleavings preserve receiver-before-argument registration and FIFO transitions.
- Valid `concat`, `push`, indexed growth, and length growth still reuse runtime-owned backing without changing earlier logical values.
- Imported Arrays never acquire ArrayView attachment or act as mutable backing, and their physical storage remains unchanged.

Update [`run.md`](run.md), [`array-view.md`](array-view.md), [`data-classes.md`](data-classes.md), and [`runtime-spec.md`](runtime-spec.md).
