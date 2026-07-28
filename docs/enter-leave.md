# Enter/Leave Path Ownership

## Status

This document specifies the planned internal `enter`/`leave` runtime primitives. They let asynchronous work claim one known effect path before waiting, preserving sequential behavior on that path while unrelated paths remain available.

```cascada
var player = {
    name: "george",
    pos: { x: 1, y: 1 },
}

if (someSlowCondition()) {
    player.pos = { x: 2, y: 2 }
}
```

A mutating entry makes `player.pos` pending before the condition is available. Work continues through a private Chain and publishes back through the pending placement on leave.

## API and Entry lifecycle

The module-internal API is:

```js
const entry = enter(chain, path, mutates)
const publication = leave(entry)
```

Its result shapes are:

```text
enter(...) -> Entry | Error | Promise<Entry | Error>
leave(active mutating Entry) -> Promise<undefined>
leave(active read-only Entry) -> undefined
```

`mutates` must be exactly `true` or `false`. The compiler passes this analysis fact directly; `enter` validates it and selects an encapsulated mutating or read-only path. These internal paths may be local helpers or direct branches, but they are not APIs and no other operation calls them.

A mutating entry becomes available as soon as the target's owning parent exists. It captures a direct target, including `undefined` or an Error, and transfers a Promise-valued target without waiting for it. Only a pending ancestor delays acquisition.

A read-only entry follows observation semantics. It waits through a Promise at the target, propagates a target Error, and protects the resulting snapshot with a read lease when needed.

An Entry exposes only:

```js
entry.chain
```

`entry.chain` is rooted at the value captured at `enter`'s exact program position. Before publication, a mutating Entry owns that data; afterward, already-issued continuations and the public world operate on the same graph through their established mirror positions, while the closed Chain permits no new issuance.

The Entry privately retains its Chain, a gate and resolver when mutating, or an acquired read-lease token when read-only. Gate presence distinguishes the two modes; there is no separate Entry kind or lifecycle flag. The Chain's access mode is the sole active/closed authority.

The Entry is opaque. It retains no source Chain, captured placement, or independent import boundary after acquisition. `enter` and `leave` are exported from `src/enter-leave.js` for compiler/runtime use but are not package-level exports from `src/index.js`.

## Mutating entries

For:

```js
const entry = enter(player, ["pos"], true)
```

the synchronous transition is:

```text
before:

player.pos  ---> position

after:

player.pos  ---> gate Promise
entry.chain ---> position
```

The gate is installed through the normal Promise-property transition and receives a fresh mirror at `enter`'s program position.

- A deeper operation such as `["pos", "x"]` traverses the gate and waits.
- An ancestor observation that includes `pos`, such as export or Error collection for `player`, also waits.
- An operation on an unrelated path continues synchronously.
- A direct assignment or deletion at exactly `["pos"]` creates a later property version immediately and detaches the gate mirror. Existing gate consumers still complete, but the later replacement remains live.

Private work uses ordinary path operations:

```js
assignPath(entry.chain, ["x"], 2)
assignPath(entry.chain, ["y"], 2)
```

The gate is the ordering channel. Every later traversal of the entered path registers after it, so private publication and later effects compose in program order without blocking unrelated data.

## Read-only entries

For:

```js
const entry = enter(player, ["pos"], false)
```

no gate is installed. The Entry holds a stable snapshot in a read-only private Chain.

A tracked root acquires a temporary read lease only when it does not already require COW. Explicitly shared, imported, or non-extensible roots need no lease; primitives need neither a lease nor metadata. While any lease is active, mutation treats the leased root like a shared root and copies before writing. Overlapping entries increment independent lease counts, and releasing one cannot weaken another lease or a permanent shared mark.

`leave` closes the Chain, releases the acquired token exactly once, and returns `undefined`. If no mutation or ownership escape occurred, releasing the last lease restores singly-owned write behavior. A mutation keeps its new copied path, and any ordinary sharing established during the lease remains permanent.

A raw snapshot must not escape its Entry lifetime. Native work using that reference must finish before leave, and a returned tracked value must establish permanent sharing first. Kernel operations issued through `entry.chain` are different: they perform available work and register pending continuations synchronously, so those continuations retain their FIFO positions and may finish after the lease is released. Chain access cannot detect native mutation through a raw snapshot; that remains a trusted host/compiler violation.

Primitive and `undefined` snapshots still use the same Entry result shape, avoiding another API variant.

## Promise frontiers

If an ancestor is pending, `enter` registers at its exact mirror position. When that ancestor becomes ready, the same FIFO continuation performs owning-path COW, captures the target, installs the gate when mutating, completes the synchronous graph transition, and only then makes the Entry acquisition result observable. Later operations resume after that transition and therefore see the gate.

A Promise at the target is different because its placement already exists. Mutating acquisition is immediate:

```text
public target       -> gate Promise
private root        -> source Promise
private root mirror -> transfer consumer sampling the source mirror
```

Before gate replacement detaches the source mirror, `enter` registers a transfer consumer at its FIFO position and installs an ordinary mirror on the private root. The consumer samples the source mirror's latest prepared live or detached value, never the Promise's raw settlement. This preserves import preparation and every earlier effect, including a mutation that COWed and replaced the detached source mirror's logical value.

Sampling does not add sharing merely because a property version had earlier consumers. If owning-path COW left that target version reachable from an old world, however, acquisition sets `retainedInOldWorld`. The transfer continuation then marks the prepared sampled tracked value shared before any later private consumer runs. It never marks the raw Promise. A direct tracked target retained by an old world is marked before the Entry escapes.

The Promise returned because an ancestor delayed acquisition represents only Entry availability. It is distinct from the public gate. If the owning property is superseded while acquisition waits, the registered mutation walk resumes against the logical placement at its FIFO position.

Pending descendants require no special entry behavior. They remain ordinary Promise properties in the private graph and may still be pending when the graph is published.

## Leave and publication

Read-only leave closes the private Chain and releases its optional lease directly.

For a mutating Entry, `leave`:

1. Validates that the private Chain is active.
2. Registers publication completion on the gate at leave's FIFO position.
3. Captures the private root; if it is pending, obtains its current mirror and internally registers one readiness continuation.
4. Closes the private Chain to new issuance.
5. Resolves the gate with the direct root, or lets the registered continuation read the mirror's prepared value and resolve the gate.
6. Returns the publication-completion Promise.

The root-mirror registration is internal, not a lookup issued through the private Chain. It is installed before closure, and its callback remains valid afterward like every continuation registered while the Chain was active.

The gate is always fulfilled. Language Errors are values, and `leave` never passes a Promise to the gate resolver because resolver assimilation would consume raw settlement and could reject or bypass mirror state.

Leave observes at most one root property version. Canonical Promise fulfillment is assimilated before the first mirror resolver publishes it, and `setMirrorValue` never publishes a Promise into an existing version. Assigning a new Promise, including the same Promise again, synchronously replaces the property with a fresh version and mirror. Root replacement also runs synchronously when issued because the private root holder is always available; a suspended operation cannot create a later root version after closure. Therefore a ready captured root mirror must expose a non-Promise value. Seeing a Promise is fatal invariant corruption.

Pending descendant operations may complete after publication. They registered their mirrors before leave, while later public consumers register after the gate, so ordinary FIFO ordering preserves their effects. The controlling rule is:

> Every operation belonging to the Entry must be issued before `leave`.

Detached work must not issue through the closed Chain. The publication Promise settles only after gate consumers that registered before leave have completed their synchronous transitions. Callers should await it before sequentially re-entering the same path. A read-only Entry must likewise be left exactly once; abandoning an acquired lease conservatively leaves COW enabled but does not gate the public path.

Every compiler-created mutating Entry must reach leave; abandoning it leaves its public gate pending indefinitely. To publish an Error, assign it to the private root and leave normally:

```js
assignPath(entry.chain, [], error)
await leave(entry)
```

To preserve the private value and return an operation Error separately, leave normally and return that Error as the operation result.

## Ownership and import attribution

Capturing a singly owned value transfers ownership from the source placement to the private Chain and back through publication. The temporary Entry reference is not a second owner and does not itself mark the value shared.

If COW above the entered placement leaves the target reachable from the old world, both worlds retain it. A direct tracked target is marked shared before private mutation; a Promise target marks its prepared sampled value in the transfer continuation before later private consumers.

Entering a shared, imported, or read-leased path uses the normal mutation walk and copies as required. Imported host data is never mutated in place. COW promotes every tracked child copied from an imported node, including the entered path value, to a direct boundary, so the private Chain needs no sticky inherited boundary. An unresolved version carries attribution in its source or transfer mirror, while a prepared tracked value carries its own META boundary. Replacing the private root therefore drops old attribution unless the new value has a boundary of its own.

The gate mirror receives the owning walk's normal imported-attachment preparation. Its published value is validated against the public destination ancestry before writeback. When the owning walk supplies an attachment path, the ordinary Promise assignment permanently pins `attachmentPath.root`. This pin must not depend on whether the destination ancestry is currently imported: private Entry work may later publish imported data that refers to a captured destination ancestor. Repeated sequential entries on such a path may therefore COW that owning path again.

## Composition and lifecycle constraints

Every mutating Entry uses a fresh gate and mirror. Sequential code that awaits each publication retains one live gate and constant gate-chain depth. Entries issued ahead of publication remain ordered but retain one Entry and its waiters per outstanding operation.

Code responsible for leaving an Entry must not wait through its own public gate:

```js
const entry = enter(player, ["items"], true)
const value = lookupPath(player, ["items", "0"])
// value depends on leave, so leave cannot be reached
```

It must use the private Chain:

```js
const value = lookupPath(entry.chain, ["0"])
```

The compiler should reject a statically visible self-wait. Dynamic self-wait is a lowering violation that can leave the gate pending.

Disjoint entries proceed independently. An Entry may enter a nested path through its private Chain:

```js
const outer = enter(root, ["player"], true)
const inner = enter(outer.chain, ["pos"], true)
```

Either Entry may leave first. If the outer graph contains the inner gate, publication carries that gate normally. If the inner Entry gates the outer private root, outer leave registers on that mirror; both leaves must be issued before awaiting outer publication, or the inner Entry must leave first.

Entering an already gated public placement also acquires immediately. The new Entry transfers the existing gate through source-mirror sampling, installs its own gate, and serializes the two data versions. Overlapping aliases continue to follow ordinary ownership and COW rules.

## Path errors and fatal failures

A missing final target is valid: mutating entry captures `undefined`, while read-only entry produces an unleased `undefined` snapshot. A missing, `null`, `undefined`, primitive, or Error intermediate produces or propagates the ordinary path Error.

A mutating Entry captures a final Error like any other value. Leaving unchanged republishes the same identity; assigning a new root replaces it. A rejected target Promise is converted once by its source mirror, so the private and published graphs receive the same language Error identity. A read-only entry propagates a final Error instead of producing an Entry.

Anticipated unsupported COW or imported-data validation produces a language Error with the existing attribution rules. Compiler misuse, host-contract violations, and invariant failures are fatal. Fatal cases include:

- a non-Boolean `mutates`;
- leaving an already closed Entry;
- mutation through a read-only Chain;
- new issuance through a closed Chain;
- invalid property descriptors during gate installation or publication; and
- a Promise reaching `setMirrorValue` or the gate resolver boundary.

## Implementation contracts

The implementation lives primarily in:

```text
src/chain.js
src/enter-leave.js
test/enter-leave.test.js
```

`src/index.js` re-exports `Chain` from `src/chain.js`, preserving its package identity while allowing `enter-leave.js` to create private Chains without importing the package entry module. Existing modules receive only narrow generic extensions: META owns lease operations, path walkers own access checks, the mutation walk owns COW and acquisition, and Promise mirrors own source sampling. Entry lifecycle concepts stay inside `enter-leave.js`.

### Chain access and leases

Chain state has one issuance capability:

```text
access: read-write | read-only | closed
```

`walkObservationPath` permits read-write and read-only Chains; `walkMutationPath` requires read-write access. Both reject closed Chains when an operation is issued. Already-issued recursive continuations do not recheck. `walkMutationPath` accepts the Chain, performs the access assertion, and derives `chain._state` internally so assignment, deletion, and mutating entry share one boundary.

Read-only acquisition reuses observation-path capture and stores only the optional token returned by `acquireReadLease(value)`. That helper increments a private counter only for a tracked value that does not already require COW and returns the value as its release token; otherwise it returns `undefined`. The mutation walk's single `requiresCopyOnWrite` predicate combines permanent sharing with a positive lease count. `hasSharedMark` remains permanent-sharing-only. Releasing a lease never clears a permanent mark, and zero-count lease metadata has no ownership effect.

### Mutation acquisition

Mutating entry reuses `walkMutationPath` with an optional one-shot acquisition sink. At the target placement, the walker passes the callback the exact parent/key, current value, attribution, attachment path, and `retainedInOldWorld === (attachmentPath !== undefined)`. The callback captures and replaces that placement synchronously before returning; no location capability escapes.

Graph reconstruction retains its existing node-value return channel. A direct terminal stores `Entry | Error` in the acquisition sink. The first pending ancestor lazily allocates the one acquisition Promise, and the terminal settles it inside the already-registered FIFO continuation while reconstruction completes in that same reaction; acquisition awaiters cannot run until the reaction returns. A final Error is a successful mutating capture. A broken intermediate or anticipated COW failure settles the acquisition channel with its Error while ordinary reconstruction still installs the Error at its language placement.

### Promise transfer and publication

COW fork and entry transfer share one private source-mirror sampling core in `src/promise-mirrors.js`. Both register with `onLaterPromiseReady`, read the source mirror's prepared live or detached value, and publish through an ordinary destination `PromiseMirror`. Narrow `forkPromiseMirror` and `transferPromiseMirror` wrappers provide destination placement, attribution, and retained-world sharing policy.

Promise-target acquisition performs one synchronous transition:

1. Obtain or create the source mirror.
2. Create the private Chain with the physical source Promise.
3. Install its transfer mirror and register the sampler.
4. Replace the public target with the gate, detaching the source mirror.

In `src/property-transitions.js`, `setMirrorValue` fatally rejects `helpers.isPromise(newValue)` before import preparation, ref indexing, descriptor changes, or publication. A new Promise always goes through `replaceProperty` and receives a fresh version. Gate assignment receives the owning walk's fixed-path `prepareImportedValue` closure so public attachment is prepared before writeback.

Mutating leave obtains the current private-root mirror, registers through `onLaterPromiseReady`, and then closes the Chain. Its callback reads `mirror.getValue(...)` and retains a local non-Promise assertion immediately before the gate resolver. This final guard protects the resolver-assimilation boundary if raw compiler or host mutation bypassed `setMirrorValue`.

## Verification

Run all coverage under inline-Symbol and WeakMap metadata modes. Parameterize the main fixtures across root/nested paths, direct/pending ancestors, direct/Promise/Error/missing targets, and owned/shared/imported/read-leased roots.

Core lifecycle and access:

- exact API result shapes and Boolean validation;
- unchanged package identity for the `Chain` re-export after moving its definition;
- direct acquisition and acquisition delayed only by a pending ancestor;
- read-write, read-only, and closed Chain issuance;
- continuations issued before closure remaining valid;
- read-only and mutating leave results;
- double leave, use after leave, and compiler-generated failure completion.

Ordering and Promise transfer:

- deeper and ancestor operations waiting while siblings continue;
- exact-path replacement superseding a live or detached gate;
- source-mirror sampling preserving pre-entry mutation, COW, attribution, and Error identity;
- transferred imported cyclic data prepared before gate publication;
- leave sampling one pending root version without following another frontier;
- global `setMirrorValue` rejection before side effects and the local leave guard after deliberate raw-state corruption;
- gate completion following earlier consumers without synchronous overtaking.

Ownership and read leases:

- singly owned transfer without a copy;
- retained direct and Promise targets marked shared before private mutation;
- shared, imported, and leased owning-path COW with external isolation;
- conditional lease acquisition, overlapping leases, release, permanent sharing, result escape, and direct live replacement;
- suspended kernel observation after lease release versus native raw-snapshot lifetime;
- refcounts, reverse parents, cycle cuts, aliases, arrays, null-prototype records, and enumerable `__proto__`.

Composition:

- sequential loops retaining one live gate and queued loops retaining linear backlog;
- nested leaves in either order, including the root-gating self-wait case;
- immediate entry of an already gated placement;
- disjoint entries proceeding independently;
- attachment-root pinning causing repeated COW without accumulating a Promise tail; and
- pending descendant mutation completing after publication in FIFO order.
