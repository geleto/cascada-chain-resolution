# External Context Ordering Architecture

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines the ordering and authority architecture behind them.

## Model

External values are exact host identities and are observation-only by default. Mutation is allowed only when every actual Cascada use of the identity has occurred through one compiler-static path of one context Chain. Import and storage are not uses.

Managed state uses COW, leases, and transition gates. External state that remains mutation-eligible uses one readers-writer phase per exact identity, shared by all context occurrences. Outside-context use is observation-only and permanently removes mutation eligibility, so it needs no phase. External mutation changes the exact host identity in place.

A selected external boundary is the first external identity whose phase was synchronously selected on an operation path. Its phase guards host traversal below that identity for that operation.

A new identity obtained from an external property remains external, including a record or Array. Managed state may contain external identities, but external state may contain no admitted managed identity. Detect this only if property traversal reaches one; poison the external container without replacing either identity and do not scan external state for violations. A host method may instead return separately declared, default-managed, or already admitted managed data through its separate result import.

External operations may traverse and mutate deeply nested host state. Cascada does not inspect external graphs in advance or compare their descendants for aliases. Host code must not expose one mutable resource through independently scheduled external roots; such hidden sharing is outside Cascada's ordering guarantees.

## Context index

Phase 9 context construction marks a Chain as context and passes its host root through the common `import(value, errorContext)` boundary. During that import, inspect each synchronously reached managed identity once while recording every external occurrence by normalized Chain path. Preserve aliases and cycles and stop at Promises and external identities. Importing, indexing, or storing an identity does not record a use or restrict later mutation.

Several context Chains may contain the same external identity. Each keeps its own path index, while the identity's use state remains unset until an operation actually uses it. Ordinary context-graph transitions maintain occurrence paths without turning them into uses.

The path index maps context paths to external identities and answers exact, longest-prefix, and descendant queries. It contains no ownership or use state. It lets ready operations select external dispatch before managed COW and lets an operation with an unresolved suffix protect every external identity it may reach.

## Use state

One execution-scoped WeakMap records each external identity's actual Cascada use:

- no entry: not yet used;
- `{ usedInContextChain, usedAtPath, allUsesStatic, mutationAuthorized }`: used only through that exact context Chain and normalized path, with sticky staticness and first-mutation facts;
- `OUTSIDE_CONTEXT`: used through a non-context Chain;
- `MULTIPLE_USE`: used through different context Chains or paths, or through both context and non-context Chains.

Every operation carries a compiler-static-path fact before graph work begins. A path is static only when every segment to the identity is a compiler-known String or Number. A computed or Promise-valued segment is dynamic even if ready. Every lookup, external receiver or property operation, and external argument use records its location and staticness before host access. Before mutation authority exists, repeating the same static context Chain and path changes nothing, a dynamic use at that location clears `allUsesStatic`, and a different context Chain or path records `MULTIPLE_USE`. A first non-context use records `OUTSIDE_CONTEXT`; mixing it with a context use records `MULTIPLE_USE`. Import, assignment, return, and storage alone remain irrelevant.

| Current state and next use | Result |
| --- | --- |
| No entry; static context use | Record its Chain and path with `allUsesStatic: true` and `mutationAuthorized: false` |
| No entry; dynamic context use | Record its Chain and path with `allUsesStatic: false` and `mutationAuthorized: false` |
| No entry; non-context use | `OUTSIDE_CONTEXT` |
| Unfixed recorded location; same static location | Unchanged |
| Unfixed recorded location; same dynamic location | Clear `allUsesStatic` |
| Unfixed recorded location; any other location | `MULTIPLE_USE` |
| Fixed location; same static location | Unchanged |
| Fixed location; any other use | Validation Error; state unchanged |
| `OUTSIDE_CONTEXT`; non-context use | Unchanged |
| `OUTSIDE_CONTEXT`; context use | `MULTIPLE_USE` |
| `MULTIPLE_USE`; any use | Unchanged |

A mutation records its use before validation. It is allowed only with one recorded context Chain and path whose `allUsesStatic` remains true. The first valid mutation sets `mutationAuthorized` before host access and fixes that location. Every later use must be compiler-static at the same Chain and path; any other use returns a validation Error without host access and leaves the fixed location unchanged. Dynamic, `OUTSIDE_CONTEXT`, or `MULTIPLE_USE` mutation produces the ordinary mutation Error, invokes no host code, and poisons any selected mutation phases.

## External phases

Every selected mutation-eligible external identity owns one readers-writer phase state, so duplicate context selections join one phase. This does not make aliases interchangeable: mutation is unavailable after incompatible prior use, and the first mutation fixes the only compiler-static location later operations may use.

Mutation-capable graph APIs receive `mutation` and `repair` as required positional Booleans, with `repair` immediately after `mutation`. Invocation becomes `run(chain, path, method, mutation, repair, args)`, where `args` is the required native Array of explicit argument values and `[]` means no arguments. The Array is operation control data, not one language argument; its elements remain separate ordered argument roots. Observation is `(false, false)`, mutation is `(true, false)`, and repair-and-mutate is `(true, true)`; `(false, true)` is invalid for an operation that would access host state. An inherently mutating API needs only a positional `repair` Boolean. A dedicated repair-only path operation performs the fourth behavior without a dummy method or callback. Cascada syntax is only one caller of these APIs.

Register every selected receiver and argument phase synchronously when the operation is issued, before waiting on a Chain, Promise, or predecessor. Freeze that phase set before the first wait; an operation never retains one phase while acquiring another. Consecutive observations share a read phase after the preceding exclusive operation; the next exclusive operation waits for the group. Publish all phase successors before waiting, merge duplicate identity entries by making the entry exclusive if any selection is exclusive and repairing if any explicit repair selection covers it, and never let entries created by one operation wait on one another.

A context external operation selects its identity directly. A marked context prefix selects the external identities indexed at or below that path. An outside-context operation records outside use before host access and proceeds observation-only without a phase unless the identity is already fixed elsewhere, in which case it fails. Phase access is shared observation or exclusive work. Mutation and repair remain independent after positional argument validation. Cascada lowers unmarked access to observation, `!` to mutation, bare `!!` to repair-only, and `!!` attached to a mutation to repair-and-mutate; this project receives only the resulting facts or repair-only call. Managed operations continue to use ordinary COW, leases, and gates. One direct operation Promise keeps its phases until boundary completion; a nested result Promise does not.

The first selected external identity on a context path guards the complete host suffix traversed through it. Deeper identities record their own use before further access but add no phase to the active operation. A context identity revealed after waiting must be covered by an already selected boundary; otherwise the operation returns a validation Error before accessing or passing it to host code. A non-context identity revealed after waiting records outside use and proceeds without a phase only when it is not fixed elsewhere. The host must keep independently scheduled roots free of shared mutable state. Identity and phase state are local to one execution.

## Exported arguments

Every native JavaScript method receives exported explicit arguments, including managed record and managed-class methods. Runtime-controlled methods such as supported Array methods consume logical Cascada values directly.

Export copies managed records, Arrays, and managed class instances while preserving aliases, cycles, and admitted prototypes. Host code may mutate or retain those copies without changing their Cascada sources. Functions and external identities remain exact and read-only as arguments. For a context source, discover indexed external argument identities and enter their observation phases with the receiver phases before waiting or export; a later identity outside that coverage fails before host access. For a non-context source, record outside use when export reaches an identity, reject one already fixed elsewhere, and otherwise pass it without a phase because future mutation is no longer possible. Passing, retaining, storing, or returning an exact identity never transfers mutation authority.

## Async control flow

Before an async condition, loop, or `enter` scope suspends, query each affected context path and reserve the phases of every external identity its child may use. Use observation mode when the child only observes and mutation mode otherwise. Child operations use child-local phase entries so they do not wait on their own outer reservation. Complete the reservation after the child drains; apply the same rule recursively.

## Poison and repair

External poison is an Error stored in the execution's phase entry for the exact identity, not in global identity metadata or application data. It never replaces the external identity or one of its properties. Existing poison contributes that Error at the selecting receiver or argument position unless that exact scope is explicitly repaired; required preparation continues, and unrepaired poison skips host code.

Ordinary observation failure does not poison. Reaching admitted managed data inside external property state is an external-containment violation. It poisons that container's selected phase, if any; an unphased outside-context access only returns the Error. A failed or rejected mutation records its combined Error on every selected mutation phase after predecessors finish; completed host effects remain visible. Dynamic, outside-context, and multiple-use mutations invoke no host code and poison any selected mutation phases.

A repair-only request enters its explicitly selected external phases exclusively, waits normally, bypasses and clears their existing poison, performs no host access, and has logical result `undefined`. It is idempotent. A repair-and-mutate request is one exclusive operation: it bypasses old poison, performs the mutation, and leaves the selected scopes clear on success or stores only the new mutation poison on failure.

Repair requires a compiler-static context path and records ordinary use without establishing mutation authority. It does not clear application Errors, ancestor or unrelated poison, use history, or mutation eligibility. The runtime supports repair-only and repair-and-mutate requests but no combined repair-and-observe request; Cascada issues repair-only followed by an ordinary observation when required.

## Host boundary

External property access and method calls operate on exact host state. Every property read imports its value; every property write exports its value before assignment. Every host-call argument is exported and every result is imported.

An external operation follows this order:

1. Select possible mutation-eligible external identities from the reached context receiver and context-path indexes; an outside-context operation selects no phase.
2. Record actual locations and static-path facts available at issuance and register all selected identity phases.
3. Wait for captured predecessors.
4. Bypass old poison only for explicitly repaired scopes. Other poison remains an input Error.
5. For repair-only, clear selected poison and complete with logical result `undefined` without host access.
6. Otherwise finish input preparation. A context identity revealed by required resolution must have an already selected external boundary. A non-context identity records outside use and is rejected only if already fixed elsewhere.
7. Validate mutation authority when requested, then perform host reflection and invoke once.
8. Import the result, store any new mutation poison, and release the phases.

External preparation follows the common operation lifecycle. A closed continuation completes shared settlement but performs no later host reflection, phase acquisition, invocation, or publication. A direct Promise keeps the phases until fulfillment import or rejection. Ready operations remain synchronous. Host code may not issue Cascada operations while its direct invocation remains active. A nested result Promise neither extends the phases nor receives later receiver or input access.

## Scope

External ordering adds one use-and-phase WeakMap shared by the Chains of an execution and one external-occurrence index per context Chain. It reuses import, export, invocation, and property boundaries and adds one external readers-writer phase mechanism. It adds no hidden Chain, compiler external classification, second importer, command scheduler, or external graph model.
