# External Context Ordering Architecture

## Model

External values are exact host identities and are observation-only by default. Mutation is allowed only when every actual Cascada use of the identity has occurred through one compiler-static path of one context Chain. Import and storage are not uses.

Managed state uses COW, leases, and transition gates. External state cannot use those protections, so every external identity has one readers-writer phase shared by all occurrences. External mutation changes the exact host identity in place.

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

A mutation records its use before validation. It is allowed only with one recorded context Chain and path whose `allUsesStatic` remains true. The first valid mutation sets `mutationAuthorized` before host access and fixes that location. Every later use must be compiler-static at the same Chain and path; any other use returns a validation Error without host access and leaves the fixed location unchanged. Dynamic, `OUTSIDE_CONTEXT`, or `MULTIPLE_USE` mutation produces the ordinary mutation Error and poisons the selected external phase without invoking host code.

## External phases

Every external identity owns one readers-writer phase state, so duplicate selections join one phase. This does not make aliases interchangeable: mutation is unavailable after incompatible prior use, and the first mutation fixes the only compiler-static location later operations may use.

Register every selected receiver and argument phase synchronously when the operation is issued, before waiting on a Chain, Promise, or predecessor. Consecutive observations share a read phase after the preceding mutation; the next mutation waits for the group. Publish all phase successors before waiting, merge duplicate identity entries at the strongest mode, and never let entries created by one operation wait on one another.

An exact external operation selects its identity directly. A context `!` prefix selects the external identities indexed at or below that path. The shared boundary uses `OBSERVE`, `MUTATE`, and `REPAIR`: unmarked external use observes, `!` mutates, and `!!` repairs. Managed operations continue to use ordinary COW, leases, and gates. One direct operation Promise keeps its phases until boundary completion; a nested result Promise does not.

Enter phases for identities as the operation reaches them, while retaining every phase already selected for the operation. This protects direct access from that point forward but cannot retroactively order hidden aliases reached through another external root. The host must keep independently scheduled roots free of shared mutable state. Identity and phase state are local to one execution.

## Exported arguments

Every native JavaScript method receives exported explicit arguments, including managed record and managed-class methods. Runtime-controlled methods such as supported Array methods consume logical Cascada values directly.

Export copies managed records, Arrays, and managed class instances while preserving aliases, cycles, and admitted prototypes. Functions and external identities remain exact. Each exact external argument records the location of its Chain source and enters its identity phase before export. An unmarked source observes; `!` mutates. Passing or returning an identity never transfers mutation authority.

## Async control flow

Before an async condition, loop, or `enter` scope suspends, query each affected context path and reserve the phases of every external identity its child may use. Use observation mode when the child only observes and mutation mode otherwise. Child operations use child-local phase entries so they do not wait on their own outer reservation. Complete the reservation after the child drains; apply the same rule recursively.

## Poison and repair

External poison is an Error stored in the identity's metadata phase state, not application data. It never replaces the external identity or one of its properties. Existing poison contributes that Error at the selecting receiver or argument position, required preparation continues, and host code is skipped.

Observation failure does not poison. A failed or rejected mutation records its combined Error on every selected mutation phase after predecessors finish; completed host effects remain visible. Dynamic, outside-context, and multiple-use mutations poison without host access.

`!!` repairs selected external identity phases only. It enters them in `REPAIR` mode, waits normally, bypasses their existing poison, and removes the poison Error on success. Repair never changes use history, so a dynamic, outside-context, or multiple-use identity remains ineligible for mutation.

## Host boundary

External property access and method calls operate on exact host state. Every property read imports its value; every property write exports its value before assignment. Every host-call argument is exported and every result is imported.

An external operation follows this order:

1. Select possible external identities from the reached receiver and any context-path indexes.
2. Record actual locations and static-path facts available at issuance and register all selected identity phases.
3. Wait for captured predecessors.
4. Finish input preparation, recording identities revealed by required resolution before host access.
5. Validate mutation authority, then perform host reflection and invoke once.
6. Import the result, update poison, and release the phases.

A direct Promise keeps the phases until fulfillment import or rejection. Ready operations remain synchronous. Host code may not issue Cascada operations while its direct invocation remains active. A nested result Promise neither extends the phases nor receives later receiver or input access.

## Scope

External ordering adds one use-and-phase WeakMap shared by the Chains of an execution and one external-occurrence index per context Chain. It reuses import, export, invocation, and property boundaries and adds one external readers-writer phase mechanism. It adds no hidden Chain, compiler external classification, second importer, command scheduler, or external graph model.
