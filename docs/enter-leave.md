# `enter` Path Ownership

## Status

This document specifies the planned internal `enter` runtime primitive. Mutating `enter` claims one known effect path before asynchronous work waits; read-only `enter` protects a captured root without gating the path.

```cascada
var player = {
    name: "george",
    pos: { x: 1, y: 1 },
}

if (someSlowCondition()) {
    player.pos = { x: 2, y: 2 }
}
```

A mutating entry makes `player.pos` pending before the condition is available. Work continues through a private Chain, and callback completion starts or arranges publication through that pending placement.

## API and lifecycle

The module-internal API is callback-based:

```js
return enter(chain, path, mutates, entered =>
    operation(entered)
)
```

If the callback returns `T`, the result shapes are:

```text
enter(..., onEntered) -> T | Error | Promise<Awaited<T> | Error>
```

`mutates` must be exactly `true` or `false`, and `onEntered` must be callable. The compiler passes the Boolean analysis fact directly; `enter` validates it and selects an encapsulated mutating or read-only path. These internal paths, completion routines, and abort routines are not APIs and no other operation calls them. Expected language Errors are returned as values. An unexpected callback throw or completion-Promise rejection closes the entered Chain before reporting the fatal failure. Read-only abort releases its read entry; mutating abort leaves the gate unresolved rather than publishing potentially corrupted private state.

Mutating `enter` uses `walkMutationPath` to perform COW and install a public gate as soon as the target's owning parent exists. After reconstruction it invokes `onEntered` immediately with a private Chain rooted at the direct target or the target Promise. Read-only `enter` uses `walkObservationPath` to resolve the complete target, then starts a counted read entry before invoking the callback; a target or path Error bypasses it. A pending ancestor delays either mode through the selected walker's Promise, without a separate readiness Promise.

`onEntered` may be synchronous or asynchronous. A synchronous callback returns its result directly; an asynchronous callback returns a Promise, including when it simply returns an existing operation or condition Promise. `enter` keeps the Chain active until that Promise fulfills, then completes the entered scope automatically: read-only completion releases the read entry, while mutating completion closes the private Chain and starts or arranges gate publication. Neither mode accepts new operations through the entered Chain afterward. The callback's return defines the scope's lifetime, so detached work must not use the Chain afterward. Compiler-level async callbacks lower waits to runtime Promise helpers; kernel code does not use raw `async`/`await` or `.then`.

`enter` returns the direct value or Promise fulfillment value from `onEntered`; it never stores the operation result on the Chain. For an asynchronous callback, one `onOperationResult` helper reaction canonicalizes the returned thenable. Fulfillment completes the scope and forwards the value; rejection aborts the scope and reports the fatal failure in that same reaction. Read-only completion releases the read entry before forwarding its result. Mutating completion initiates publication before forwarding its result but does not wait for the gate or its consumers. This keeps the operation result independent from receiver publication while letting the planned `run` operation use `enter` directly.

`enter` does not prepare result ownership. Before returning a direct tracked result or fulfilling with one, the callback's consumer applies the ordinary ownership rules. Any result identity that also has another language owner, including reachability from the entered `state.value` at scope completion, must become shared; a newly owned result ceded to the caller need not.

The callback's Chain is rooted at the property version captured at `enter`'s exact program position, which may still hold a Promise. Before publication, a mutating Chain owns that data; afterward, already-issued continuations and the public world operate on the same graph through their established mirror positions. Completion deletes `mutates`, preventing new issuance through the Chain.

Every active Chain state has an own Boolean `mutates`: ordinary and mutating entered Chains use `true`, while read-only entered Chains use `false`. Completion or abort deletes it, and its absence prevents new issuance. The mutating setup and completion closures retain the gate resolver; the gate itself already lives at the public placement, so neither belongs in the Chain state. After setup, no entry-specific lifecycle state retains the source Chain, captured placement, or an independent import boundary. Only `enter` is exported from `src/enter.js` for compiler/runtime use, not from the package entry module.

## Mutating entries

For example:

```js
return enter(player, ["pos"], true, entered => {
    assignPath(entered, ["x"], 2)
    assignPath(entered, ["y"], 2)
})
```

the synchronous transition is:

```text
before:

player.pos  ---> position

after:

player.pos ---> gate Promise
onEntered receives a Chain rooted at position
```

The gate is installed through the normal Promise-property transition and receives a fresh mirror at the mutating `enter`'s program position.

- A deeper operation such as `["pos", "x"]` traverses the gate and waits.
- An ancestor observation that includes `pos`, such as export or Error collection for `player`, also waits.
- An operation on an unrelated path continues synchronously.
- A direct assignment or deletion at exactly `["pos"]` creates a later property version immediately and detaches the gate mirror. Existing gate consumers still complete, but the later replacement remains live.

The gate is the ordering channel. Every later traversal of the entered path registers after it, so private publication and later effects compose in program order without blocking unrelated data.

## Read-only entries

No gate is installed. The callback receives a read-only Chain rooted at the captured value.

Every tracked root increments `META.readEnterCount`, including one already protected by sharing, import, or non-extensibility. Primitives need neither a count nor metadata. Overlapping read-only Chains increment independently, and mutation treats any positive count as a COW condition. This protects the captured root from mutations issued after acquisition until callback completion: those mutations copy away, while earlier effects and Promise settlement remain part of the captured world. Commands issued through the entered Chain use ordinary mirror semantics.

The callback may wait before issuing commands because its returned Promise keeps the Chain active and its read count acquired. After it fulfills, read-only `enter` prevents new issuance and calls `releaseReadEnter(state.value)` exactly once. Already-issued commands remain valid through their captured mirrors. Completing one read entry cannot weaken another or any permanent protection; if no mutation or ownership escape occurred, completing the last read entry restores singly-owned write behavior.

A raw captured value must not escape the entered Chain's lifetime. Native work using that reference must finish before `onEntered` returns or its returned Promise fulfills. The caller must establish permanent sharing for a returned tracked value before read completion; the planned `run` helper owns that preparation. Issuance checks cannot detect native mutation through the raw value; that remains a trusted host/compiler violation.

Primitive and `undefined` values still use the same callback-Chain shape, avoiding another API variant.

## Promise frontiers

### Pending ancestors

A pending ancestor delays both mutating and read-only `enter`. `enter` supplies the mode-specific callbacks; the selected path walker owns traversal and all Promise registration. It captures each pending segment at its exact mirror position, returns the helper-produced Promise, and invokes the appropriate callback when it reaches the mode-specific target boundary.

For mutating `enter`, a path continuation resumes the mutation walk, performs owning-path COW, installs any target transfer mirror and the gate, then invokes the post-reconstruction callback before returning. Consumers registered on the ancestor after mutating `enter` run afterward, observe the completed gate installation, and traverse the gate in their ordinary FIFO order. Earlier registrations retain their earlier positions. Nested pending segments compose by normal Promise assimilation.

For read-only `enter`, `walkObservationPath` likewise invokes its resolution callback before the appropriate FIFO continuation returns. The resolution callback starts the read entry and invokes `onEntered`, or bypasses it for a target or path Error. The walker returns the existing helper Promise, which assimilates that result.

If the owning property is superseded while mutating entry setup waits, the mutation walk resumes against the logical placement at its FIFO position. Neither mode stores readiness state, the source Chain, the public path, or a pending-operation queue on the entered Chain; a direct path registers no Promise helper.

### Promise-valued mutating target

When the mutation walk reaches a Promise-valued target, it obtains the source mirror and creates the private Chain with that same Promise in `state.value`. Before replacing the public placement with the gate, it installs a transfer mirror on the private root and registers the transfer through `onLaterPromiseReady` at mutating `enter`'s FIFO position. Gate replacement then synchronously detaches the source mirror. After graph reconstruction, `onEntered` runs immediately.

Promise reactions cannot run until the synchronous gate transition returns. The source version's earlier resolver therefore writes the prepared logical value to `sourceMirror.detachedValue` before the transfer callback reads it. The transfer retains neither source parent nor key, never consumes the raw settlement, marks the value shared when `attachmentPath` shows that an old COW world retained it, and writes it through the private transfer mirror. Target-dependent commands issued through the Chain register on the same canonical source Promise after this transfer; target-independent callback work proceeds immediately and may complete before the target. A derived proxy Promise would fragment the source's FIFO batch and is forbidden. This single transfer mirror restores concurrency without an Entry object, readiness Promise, or command queue.

### Promise-valued read-only target

`walkObservationPath` handles a Promise-valued target like any other Promise-bearing path segment: it registers at the mirror's exact FIFO position and invokes its resolution callback with the prepared value or converted rejection Error. The callback bypasses `onEntered` for an Error; otherwise, it calls `acquireReadEnter(value)` before creating the Chain and invoking `onEntered`. Each overlapping read-only entry increments the resolved tracked value's counter independently. There is no gate or separate target mechanism.

### Pending descendants

Pending descendants do not delay entry setup in either mode. They remain ordinary Promise properties: mutating `enter` may publish the private graph while they are pending, while operations in a read-only callback observe them through normal path semantics.

## Completion and publication

Here `state` means the entered Chain's private `_state` holder. After the callback returns directly or its returned Promise fulfills, `enter` automatically completes the scope. Both modes first delete `state.mutates`, preventing new issuance. Read-only completion then releases `state.value` and returns or forwards the operation result. Mutating completion stores the current `state.value`; if it is direct, the lexically captured gate resolver publishes it immediately, while a Promise value receives one `onLaterPromiseReady` callback that reads the current `state.value` and publishes it. The operation result is then returned or forwarded without waiting for publication.

Only gate publication needs this readiness callback; it does not extend the Chain lifetime or delay the operation result. The private-root mirror's transfer or assignment resolver and every earlier private operation are already registered on the stored Promise, so `onLaterPromiseReady` runs after they have written the latest logical value to the authoritative `state.value` slot. Root replacement itself is synchronous and new issuance is then forbidden, so this slot cannot be superseded before the callback reads it. Ordinary graph properties still require their captured mirrors because they may detach; this closed private-root slot does not.

Passing the stored Promise directly to the gate resolver would instead use native resolver assimilation, which observes the raw settlement rather than the later `state.value`, can invoke a callable thenable again, and can reject the gate.

After successful scope completion, the gate is always fulfilled. Language Errors are values, and completion never passes a Promise to the gate resolver because Promise resolver assimilation would consume raw settlement and could reject or bypass mirror state.

Mutating completion waits on at most one stored `state.value` Promise. Canonical Promise fulfillment is assimilated before the first mirror resolver publishes it, and `setMirrorValue` never publishes a Promise into an existing version. Assigning a new Promise, including the same Promise again, synchronously replaces the root slot with a fresh version and mirror. A suspended operation cannot create a later root version after closure. Therefore `state.value` must be non-Promise when the readiness callback runs. Seeing a Promise is fatal invariant corruption.

Pending descendant operations may complete after publication. They registered their mirrors before callback completion, while later public consumers register after the gate, so ordinary FIFO ordering preserves their effects. The controlling rule is:

> Every operation through the entered Chain must be issued before `onEntered` returns or its returned Promise fulfills.

Detached work must not issue through the closed Chain. The mutating result is not a publication signal: it may be returned or fulfilled while the gate is still publishing or waiting for the stored `state.value` Promise's readiness callback. Re-entering or otherwise operating on the public path remains correct because the installed gate orders that work. Returning a Promise from the callback keeps both mutating and read-only scopes active until asynchronous work finishes.

Assigning an Error to the private root publishes it as data. Returning an operation Error without replacing the root preserves and publishes the private value instead.

## Ownership and import attribution

Capturing a singly owned value transfers ownership from the source placement to the entered Chain and back through publication. Holding the Chain is not a second language owner and does not itself mark the value shared. Result preparation must nevertheless mark any returned identity that remains reachable from a read-only captured root, the mutating graph that will be published, or another retained world.

If COW above the entered placement leaves the target reachable from the source graph, both graphs retain it. A direct target is marked shared before `onEntered`; for a Promise target, the transfer callback marks the prepared value before later private consumers run. The retention condition comes directly from `attachmentPath`, without a separate Boolean.

Entering a shared or imported path, or one with active read entries, uses the normal mutation walk and copies as required. Imported host data is never mutated in place. COW promotes every tracked child copied from an imported node, including the entered path value, to a direct boundary, so the private Chain needs no sticky inherited boundary. An unresolved version carries attribution in its source or transfer mirror, while a prepared tracked value carries its own META boundary. Replacing the private root therefore drops old attribution unless the new value has a boundary of its own.

The gate mirror receives the owning walk's normal imported-attachment preparation. Its published value is validated against the public destination ancestry before writeback. When the owning walk supplies an attachment path, the ordinary Promise assignment permanently pins `attachmentPath.root`. This pin must not depend on whether the destination ancestry is currently imported: private work may later publish imported data that refers to a captured destination ancestor. Repeated sequential entries on such a path may therefore COW that owning path again.

## Composition and lifecycle constraints

Every successful mutating entry uses a fresh gate and mirror. Awaiting its operation result does not wait for publication. Calls issued before earlier gates publish remain correctly ordered, but retain a gate, any target transfer version, and their waiters per unpublished entry. Immediate Promise-target callbacks deliberately permit this pipelining; bounding it would require awaiting a separate publication signal.

The callback must not wait through its own public gate:

```js
return enter(player, ["items"], true, entered => {
    const value = lookupPath(player, ["items", "0"])
    // value depends on callback completion, which is waiting for value
    return value
})
```

It must use the entered Chain:

```js
return enter(player, ["items"], true, entered => {
    const value = lookupPath(entered, ["0"])
    return operation(value)
})
```

The compiler should reject a statically visible self-wait. Dynamic self-wait is a lowering violation that can leave the gate pending because automatic completion waits for `onEntered` to return or for its returned Promise to fulfill.

Disjoint entries proceed independently. A mutating callback's Chain may itself be passed to another mutating `enter`:

```js
return enter(root, ["player"], true, outer =>
    enter(outer, ["pos"], true, inner =>
        operation(inner)
    )
)
```

Returning the inner mutating `enter` result keeps the outer Chain active until the inner callback completes. Inner completion closes its Chain and initiates its gate publication before forwarding the result; outer completion may therefore publish a graph that still contains the inner gate. That gate preserves the required ordering without a LIFO stack. An inner entry-setup Error bypasses the inner callback but still becomes the outer operation result, so the outer scope completes automatically without a separate cleanup path.

Mutating entry setup at an already gated public placement treats the existing gate as a Promise-valued target. It installs its transfer mirror and successor gate immediately, then invokes `onEntered`; target-dependent private commands and publication wait at the predecessor gate's mirror position, while independent callback work overlaps it. The two data versions serialize through their property versions without a separate global Promise tail. Overlapping aliases continue to follow ordinary ownership and COW rules.

## Path errors and fatal failures

A missing final target is valid: mutating entry captures `undefined`, while read-only entry captures `undefined` without a counted read entry. A missing, `null`, `undefined`, primitive, or Error intermediate produces or propagates the ordinary path Error.

A mutating entry captures a final Error like any other value and invokes `onEntered` with a Chain rooted there. Completing unchanged republishes the same identity; assigning a new root replaces it. A rejected target Promise is converted once by its source mirror and transferred as that same language Error identity unless the private root was superseded. The mutating callback may already be running while the target is pending. A read-only entry returns or fulfills with a final Error without invoking `onEntered`.

The Promise returned by `onEntered` describes control-flow completion; it is not a data Promise, and rejection is fatal. Compiler lowering must convert an expected data-Promise rejection to an Error value before it reaches this boundary. For example:

```js
return enter(chain, path, true, entered =>
    helpers.onInitialPromiseResolve(calculate(item), value => {
        if (helpers.isError(value)) {
            assignPath(entered, [], value)
            return value
        }
        return operation(entered, value)
    })
)
```

Returning the Error without assigning it instead preserves the private root. An unexpected callback or host failure remains fatal.

If `onEntered` throws or its returned Promise rejects, `enter` aborts before reporting the fatal failure. Abort deletes `state.mutates`; read-only abort also releases its acquired read entry exactly once. Mutating abort does not resolve the gate. The private Chain is therefore closed and temporary read ownership cannot leak, while potentially corrupted private data remains unpublished.

Anticipated unsupported COW or imported-data validation produces a language Error with the existing attribution rules. Compiler misuse, host-contract violations, and invariant failures are fatal. Fatal cases include:

- a non-Boolean `mutates` or non-callable `onEntered`;
- mutation through a read-only Chain;
- new issuance through a closed Chain;
- invalid property descriptors during gate installation or publication; and
- a Promise reaching `setMirrorValue` or the gate-resolver boundary.

## Implementation contracts

The implementation lives primarily in:

```text
src/chain.js
src/enter.js
test/enter.test.js
```

`src/index.js` re-exports `Chain` from `src/chain.js`, preserving its package identity while allowing `enter.js` to create private Chains without importing the package entry module. Existing modules receive only narrow generic extensions: META owns read-entry counting, path walkers own issuance checks, the mutation walk owns COW and mutating entry setup, Promise mirrors own source sampling, and the Promise helpers own asynchronous operation-result forwarding. The stable `chain._state` holder contains the language root in `value` and its issuance capability in `mutates`; path operations traverse only through `value`. A root value may be primitive, shared, or replaced, while a mirror may be absent or detached, so neither language META nor `PromiseMirror` owns this lifecycle.

### Chain capability and read entries

A Chain state that can issue operations has one capability:

```text
mutates: true | false
```

Ordinary Chains initialize `mutates: true`, and an entered Chain receives the exact Boolean validated by `enter`. `walkObservationPath` accepts either Boolean; `walkMutationPath` requires `true`. Both reject a state without its own `mutates` property, which means the Chain can no longer issue operations. Already-issued recursive continuations do not recheck. `walkMutationPath` accepts the Chain, performs this assertion, and derives `chain._state` internally so assignment, deletion, and mutating entry share one boundary.

Read-only entry setup reuses observation-path capture and calls `acquireReadEnter(value)`, which increments `META.readEnterCount` for every tracked value and does nothing for a primitive. `releaseReadEnter(state.value)` decrements the same captured root and deletes the counter at zero. The mutation walk's single `requiresCopyOnWrite` predicate combines its existing permanent conditions with a positive `readEnterCount`; `hasSharedMark` remains permanent-sharing-only. Completing the last read entry removes only the temporary COW condition and never clears permanent protection.

### Mutating entry setup

Mutating entry reuses `walkMutationPath` with an optional post-reconstruction callback. At the target placement, the terminal receives the exact parent/key, current value, attribution, and attachment path. A direct value is recorded for the private Chain. A Promise target creates that Chain immediately, installs its transfer mirror before the public gate, and is likewise recorded directly. The location never escapes.

The recursive walk keeps its node-value return channel. Its result propagation is:

```js
function walkFrame(value, index, writeBack) {
    let pending
    const node = walk(value, index, next => { pending = next })
    writeBack(node)
    return pending ?? finishCapturedTargetOrError()
}

// A Promise branch inside walk:
recordPending(onLaterPromiseReady(promise, () =>
    walkFrame(mirror.getValue(parent, key), index + 1, writeBack)
))
return parent
```

The outer call and each resumed Promise frame own one optional pending slot. Only helper-produced Promises enter that slot, so `undefined` unambiguously means that reconstruction reached the target or an entry-setup Error. Each frame completes synchronous writeback before returning its deeper helper Promise or invoking the final callback. A Promise-valued target itself adds no setup frontier because its private Chain is available immediately. `onEntered` therefore runs exactly once after reconstruction, without a sentinel, `{ node, result }` return record, explicit `new Promise`, or second reaction on one source.

The pending slots belong only to active mutation-walk call frames. The entered Chain contains no readiness state, source Chain, captured public path, or operation result, and gains no pending-command method or queue. A direct callback result is returned after synchronous scope completion. `onOperationResult(promise, onFulfilled, onRejected)` registers one reaction on the canonical Promise. Fulfillment runs normal completion through `runFatal`; rejection invokes entry's abort-and-report callback directly. Its derived Promise is the wrapped operation result; delayed path helpers assimilate it normally, independently of publication.

### Gate transitions

For a Promise target, `transferPromiseMirror` obtains the source mirror, installs an ordinary `PromiseMirror` on private `state.value`, and registers one source-sampling callback before gate replacement. Successful gate replacement guarantees that the source mirror is detached before the callback can run. Its earlier version resolver writes the prepared value to `detachedValue`; the transfer callback reads that field, applies the `attachmentPath` sharing rule, and calls `setMirrorValue` on the transfer mirror. The asynchronous callback therefore retains no source placement. The private holder is unindexed, but the mirror preserves version state and import attribution for ordinary Chain walkers. `forkPromiseMirror` remains separate because a fork may need to sample a live source placement.

Gate installation creates an assigned mirror and calls `replaceProperty`, whose `commitLiveEdge` transaction captures the old contribution, detaches the old mirror, writes the gate, removes the old tracked child's reverse-parent edge, substitutes the gate's pending-Promise contribution, and propagates the delta through indexed ancestors. For a Promise target, the detached source and new gate each represent one pending version, so the immediate count delta is normally zero; later source settlement cannot affect the public edge. An unindexed parent has no reverse edge or counters to update.

Gate publication uses `setMirrorValue` through the same transaction: it indexes the published root when the public owner is indexed, adds its reverse-parent edge when tracked, and replaces the gate's pending contribution with the root's counters. The private `chain._state` holder is host state rather than a language-graph parent, so capturing a root adds no reverse-parent edge. When COW retained the source target, direct setup or the transfer sampler has already marked the private root shared.

`setMirrorValue` fatally rejects `helpers.isPromise(newValue)` before import preparation, ref indexing, descriptor changes, or publication. A new Promise always goes through `replaceProperty` and receives a fresh version. Gate assignment receives the owning walk's fixed-path `prepareImportedValue` closure so public attachment is prepared before writeback.

## Verification

Run all coverage under inline-Symbol and WeakMap metadata modes. Parameterize the main fixtures across root/nested paths, direct/pending ancestors, direct/Promise/Error/missing targets, and owned/shared/imported roots or roots with active read entries.

Core lifecycle and access:

- exact result shapes, validation, exactly-once callback invocation, Error bypass, and synchronous callback throws or returned callback-Promise rejection closing the Chain before fatal reporting;
- callbacks running only after reconstruction, directly or within the existing ancestor helper continuation, with no readiness Promise or second same-source reaction;
- `mutates: true`, `mutates: false`, closed-Chain issuance, continuations issued before closure, and use after completion;
- synchronous and Promise callback lifetimes, successful closure and read release or publication, abnormal closure with read release but no mutating publication, and direct or `onOperationResult` result forwarding;
- operation results never stored on the Chain and lexical gate-resolver retention adding no gate lifecycle fields; and
- unchanged `Chain` package identity after moving its definition.

Ordering and Promise targets:

- later ancestor consumers traversing the installed gate while earlier registrations retain their positions, deeper and ancestor operations waiting, and siblings continuing;
- immediate gate installation, exact-path supersession, and operation-result delivery remaining independent from publication;
- detached-source-to-transfer-mirror sampling preserving prior effects, COW, attribution, Error identity, imported cyclic preparation, and one canonical FIFO batch;
- immediate callback and independent work for a Promise target, while target-dependent commands and publication wait through its private-root transfer mirror;
- direct target capture without a root mirror, Promise target capture with exactly one transfer mirror, and one publication registration for any pending private root; and
- `setMirrorValue` rejection before side effects, the local publication guard after raw-state corruption, and FIFO gate publication.

Ownership and read entries:

- singly owned transfer, retained targets marked shared from `attachmentPath`, and owning-path COW for shared, imported, or actively read values;
- mode-independent result preparation marking identities that alias the captured root while preserving ownership transfer for wholly new results;
- uniform and overlapping read counts, release without weakening permanent protection, direct live replacement, and result aliases becoming shared before release;
- an export captured before mutating entry retaining its issue-time world across unmarked ownership transfer and private in-place mutation;
- suspended kernel observation after read completion versus native raw-value lifetime;
- exact reverse edges and counters across direct capture, Promise-mirror detachment, publication, and the non-graph private holder; and
- cycle cuts, aliases, arrays, null-prototype records, and enumerable `__proto__`.

Overlapping entries:

- read then read, with direct and gated targets, independently incremented counts, asynchronous callbacks, staggered completion, and successive counts of two, one, and zero;
- read then mutate on a direct target, proving a later mutation performs COW and leaves the captured read world unchanged;
- a read registered before a mutation on the same predecessor gate, proving the read acquires its count synchronously before the following mutation callback runs even when the read callback remains asynchronous;
- a mutation issued before a read, proving the read captures the new gate and starts only from the mutation's published logical value;
- mutate then mutate, proving the second gate and callback start immediately while its target-dependent commands and publication wait for the first gate's captured version;
- mutate then read then mutate, proving the read captures the first gate, the second mutation installs its successor gate, and the second mutation performs COW while the intervening read remains active;
- read at an ancestor versus mutation at a descendant, read at a descendant versus ancestor replacement, and distinct paths aliasing the same tracked value;
- representative direct and Promise-valued targets and private roots with synchronous and asynchronous callbacks; and
- overlapping mutating entries proving that each lexical resolver publishes only its own private `state.value`.

Composition:

- repeated entries, including awaited callbacks that finish before target readiness, retaining backlog proportional to gates that have not yet published;
- nested callback scopes closing inside-out even when inner publication remains pending;
- compile-time rejection of a statically visible self-wait and a dynamic self-wait remaining a documented lowering deadlock;
- immediate callback for an already gated placement, with target-dependent work retaining predecessor FIFO order;
- disjoint entries proceeding independently;
- attachment-root pinning causing repeated COW while ordinary gates represent any publication backlog; and
- pending descendant mutation completing after publication in FIFO order.
