# Promise-Valued Path Segments Architecture

Developer-facing path restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines their runtime architecture.

## Model

A path segment is a String or Number operation input. Normalize it only after it is ready. Any other resolved value produces a validation Error, and a Promise-valued segment must never be stringified as a Promise object.

The path Array carries the Promise itself. No sideband prefix length or segment-origin metadata accompanies it.

The operation protects the longest resolved path prefix before a continuation remains pending. This is the narrowest scope that can preserve sequential behavior while the next key is unknown.

## Preparation

Observation and mutation keep their existing walkers because mutation additionally owns COW, writeback, gating, and failure publication. Centralize their identical direct-or-Promise segment consumption and String/Number validation. Both walkers follow the same one-time prefix-protection and resumption protocol through their existing lease or gate transitions.

Walk ready leading segments synchronously. Consume a possible custom thenable through the common helper and continue traversal in its callback. A synchronous delivery extends the same resolved prefix. Once traversal selects the target, readiness belongs to the target operation: its independent pending result adds no prefix protection. Only a returned pending chain for unfinished path selection acquires one prefix scope before the issuing stack returns:

- An observation leases the reached prefix value. Later managed mutations use COW, so the observation can continue through its captured value without delaying them.
- A mutation installs the ordinary transition gate at the reached managed prefix placement and continues against its private working value. Later operations through that prefix wait; unrelated paths continue. On a context Chain, query the static external mutation tree and register every possible live external phase before installing the gate.

Consume each later segment through the common Promise and Error preparation only when traversal reaches it. A direct returned result continues the current transition; unfinished path work resumes from the existing protected prefix without acquiring another scope. Each path selection has one local `pathSelectionComplete` fact, initially false and set immediately before invoking the selected target operation. Reuse an already-retained selected target if its presence has exactly that meaning; otherwise retain the Boolean across this path's continuations. Do not wait for the target operation to return or settle before setting it. This semantic handoff is distinct from callback execution and result readiness: `!pathSelectionComplete` plus a pending result requires prefix protection, while a pending result after handoff belongs to the target operation. For example, a ready custom key selecting an Array whose `pop()` removes a pending element completes traversal and receiver publication immediately; only the removed element's independent result waits, and no prefix gate or lease is added.

Initialize callback-visible staging, captured versions, and enclosing writeback required regardless of readiness before subscribing: a callback may run inside `then`. Pending-only gates, Promise versions, leases, and registrations are installed only after the returned transition proves that their dependency remains pending. JavaScript run-to-completion prevents asynchronous delivery from interleaving before that installation and the issuing stack returns. Completion releases the observation lease or publishes the mutation gate, so several pending segments still use one prefix scope without waiting for unused segments. An existing scope follows its ordinary capture or publication handoff; an independent result cannot extend protection after that work is complete.

If the known prefix already fails, return or publish the ordinary path Error without waiting for unused segments. If segment preparation fails, an observation returns that Error and a mutation applies the ordinary failure rule at its gated prefix.

An unused segment Promise remains host-owned. Cascada does not wait for it or attach a rejection observer merely to suppress host-level unhandled-rejection reporting.

The compiler keeps initial mutation-tree discovery synchronous. A mutation path containing a dynamic or Promise-valued segment contributes its longest preceding String/Number prefix as a conservative scope-discovery path: `apis[pendingKey]!.run()` contributes `["apis"]`, and `[pendingKey]!.run()` contributes `[]`. Dynamic assignment and deletion use the same rule. The runtime path still carries the actual Promise and no sideband prefix fact.

Prefix-wide mutation ordering is unavoidable. For `value[pendingKey]`, no descendant is known until the key resolves, so a later operation anywhere beneath `value` may conflict.

## Operation lifetime

Promise-valued path work uses the owning operation's common lifetime. A path component reuses its containing operation's owner. A standalone public path operation obtains one `OperationOwner` through one centralized provision point, either at operation entry or when it first registers asynchronous work. The choice is an allocation optimization, not semantics; it must not spread optional-owner branches through path walkers. Every pending segment continuation, external predecessor wait, and other asynchronous registration goes through the common guarded helpers. Only returned pending work triggers pending owner state, and prefix protection requires unfinished path selection; an independent result after target handoff cannot trigger it. The original input's callable `then` is not a readiness signal. This is generic operation state, not query state, and property-version APIs remain unaware of it. A registered continuation first completes shared placement-version, refcount, and required settlement bookkeeping. If the operation has closed, it performs no later key normalization, traversal, lease or gate acquisition, external-phase work, host access, publication, or result production.

Observe every pending walker continuation at its originating layer even when a non-blocking mutation API does not return that Promise.

During normal or language-Error completion, publication required to finish an observation, gated mutation, or repair happens before that operation closes. Ordinary owner closure inside a live execution does not cancel an installed gate, release an external phase early, or replace their completion rules. Fatal execution failure adds no gate or phase transition: a resumed continuation sees the failed execution first and simply returns before settlement, publication, or host access. A never-resumed gate or phase may remain pending; fatal commit independently rejects every currently pending operation result through its registered outward rejection action. A standalone observation closes when its result or language-Error outcome is determined. A pending mutation normally closes only after its gate publishes success or failure; its immediate non-blocking API return is not completion and therefore needs no outward registration. A pending repair normally closes after its selected external phase publishes repair success or failure. When path resolution is one component of invocation, export, or an Error query, only that larger owner determines the outcome and the path creates no independent lifetime.

`hasError` and `getErrors` reuse their query owner, path export reuses its export owner and separate output lifetime, and `run` and `enter` reuse their containing owner. `readPath` inherits the owner and external-selection policy of the operation consuming its temporary result. `repairPath`, standalone lookup, and ordinary mutation use the centralized owner provision above. This changes lifetime plumbing only; their completion, Error, cleanup, and ready-path behavior stays unchanged.

## External state

When a segment subscription leaves context-path selection unfinished, query the ready prefix in its static external mutation tree before the issuing stack returns. An independent result after target selection does not trigger reservation. An exact reached boundary uses its ordinary phase and current binding validation before host access. Repair-only stops there and selects its repair phase without granting authority. Otherwise register an exclusive provisional phase for every live leaf the unresolved suffix may reach, even for an observation. This conservative reservation preserves issuance order while the location is unknown. Derive live authority from shared entries without deleting invalid discovery leaves. Provisional selection is protection, not permission or registration. Freeze the phase set before waiting.

A phase selected only for the unresolved suffix is provisional. It is exclusive for ordering but grants no mutation authority. If resolution does not select that boundary, it contributes no use, authority, predecessor poison, or operation Error, but still completes after its predecessor with the prior poison record unchanged. Resolution failure leaves provisional phases unpoisoned. A leaf independently selected by an explicit broader mutation scope remains an actual mutation entry.

Publish the managed prefix protection and all selected external phases before waiting on any predecessor. After resolution, retain the exact normalized path and acquire no new phase. Apply the consuming operation's terminal policy and validate the complete exact selection against current bindings before host access. Rejected capability extraction and terminal Error inspection grant no authority; `readPath` inherits its containing policy. Repair requires a valid existing location. Regular-Chain/off-path access returns a local Error and never poisons the context binding or phase; a provisionally reserved unauthorized boundary relays predecessor state unchanged. A known invalid binding returns its shared Error, not observation-only fallback. An unregistered identity remains observation-only.

Prefix protection composes with the containing operation rather than becoming a second transition. A mutating `run` or `enter` retains the prefix gate as its publication gate through direct completion. An observational `run` or `enter`, export, and an Error query complete their final capture before releasing the prefix lease; retaining the coarser lease is valid when simpler. `readPath` itself transfers no ownership, and repair retains its exclusive phase through publication. There is no unprotected handoff or independently published receiver gate.

An `enter` callback waits until every Promise-valued key needed to identify its target resolves. A Promise stored at the resulting target is different and retains ordinary `enter` behavior.

Repair-only consumes segments only until the first external boundary because a repair marker inside opaque external state repairs that boundary. It does not resolve or observe the remaining suffix. When provisional selection was required, stop resolution at the reached boundary and complete every unselected provisional phase unchanged.

## Scope

Extend the existing observation and mutation walkers through their shared segment transitions rather than adding operation-specific paths. Reuse the existing read-lease counter, COW predicate, transition-gate placement, Promise versions, and publication transitions. Share lower-level transitions with `enter` where they are identical, but do not merge the observation and mutation walkers, route ordinary path operations through `enter`, create temporary Chains, or add another queue or path scheduler. Ready paths retain their current synchronous behavior.
