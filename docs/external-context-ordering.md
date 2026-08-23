# External Context Ordering Architecture

## Model

External values are exact host identities and are observation-only by default. During `initializeContext`, every synchronously reached identity with one unique context path becomes context-exclusive and mutation-capable at that fixed path. It is then accessed only through that path or an active function borrow; identities with several paths remain observation-only.

Managed operations never use external ordering. Managed observations use leases, mutations use COW and transition gates, and managed reference entry uses ordinary `enter`.

## Guard paths and fixed bindings

Each context execution owns one sparse guard tree in an ordinary supplemental Chain. Internal `initializeContext` uses the common private importer to record synchronously reached external paths and fix every uniquely reached identity to its path. An alias or cycle that provides another placement-key sequence leaves that identity observation-only. Commit these facts only after the import segment validates completely. Initialization creates no barriers, adds no second importer or walk, and does not wait or search beyond available data. No mutation-capable path is added later.

Ordering is local to that execution. If several executions use the same mutable host resource, the host owns their concurrency and ordering.

The compiler supplies an operation's complete target path and the index of its `!` segment, or no index for an observation. An external mutation path and its `!` scope must be compiler-static: every segment is a literal property or index known during lowering. The mutation scope is the path prefix ending at that index; an observation uses its complete ready path. `!!` selects the same scope in repair mode. Managed dispatch uses `!` only as an ordinary mutation request and creates no external guard state.

For example, `apis.user.create!()` has receiver placement `apis.user` and guard scope `apis.user.create`, while `apis.user!.setName()` uses the same receiver placement and guard scope `apis.user`.

Operations add missing scope nodes lazily from selected paths. A node is a stable ordering coordinate while it records a fixed path, barrier, or poison and may otherwise be pruned.

Mutation requires the exact external receiver fixed to the operation's static receiver path by `initializeContext`. Its selected guard scope may stop at an ancestor or extend through the selected method and may differ between operations. A ready computed path may observe a context-exclusive identity after registering its resolved guard path, but a path with an unresolved segment cannot access one. Observation-only external state needs no guard.

Any managed Cascada mutation whose target or receiver is a fixed external path or an ancestor fails before invocation or publication. It returns a validation Error without changing or poisoning the context or guard. Sibling mutations remain valid, and COW or materialization may replace managed storage while preserving the same logical path and exact external identity. Explicit external property writes and method mutations may change state inside that exact identity under its guard; native or application code must not mutate the imported managed context or replace its placement independently.

## Ordering

Two scopes overlap when either path is an ancestor of the other. Keep operation state only at each selected scope node; entering an ancestor does not write its descendants. Registration finds preceding barriers on overlapping ancestors and descendants, so order works in both directions while siblings remain independent.

The selected `!` scope must contain every external state the operation may change and every observation that must wait for it. Cascada cannot infer relationships hidden inside host code; choosing sibling scopes for operations that touch the same state is a host contract violation.

A node holds the latest mutation barrier and the current observation group. An observation waits for preceding mutation barriers, joins the observation group, and never waits for another observation. A mutation waits for preceding mutation and observation barriers. Publish new barriers synchronously before waiting, so later overlapping operations cannot overtake them. A direct operation Promise keeps its barriers until settlement.

Normalize every scope selected by one operation, capture its complete predecessor set, then publish all its barriers in one synchronous transition. Barriers owned by that operation never depend on one another.

## Function calls

An exact context external argument is an observation borrow unless its source path has `!`, in which case it is a mutation borrow. Register every borrowed scope before argument preparation and keep it through the function's direct Promise. A borrow may pass through nested calls but cannot be retained, returned for later use, or used by detached work.

Managed arguments cross ordinary host boundaries as exported copies. Any explicit managed reference facility uses ordinary managed `enter`, not this tree.

## Async control flow

Before an async condition or loop suspends, bulk-enter every external scope the child may mutate. The child uses those entered scopes, while later overlapping operations wait and unrelated paths continue. Completion releases every scope even when the branch performs no mutation.

## Poison and repair

An observation failure releases its barriers without poisoning. A mutation failure or rejection stores its Error on the selected guard scope rather than replacing application data. Later overlapping ordinary operations short-circuit.

The compiler lowers `!!` to repair-mode guard entry. Repair waits normal predecessors but may run through selected poison. Success clears poison at its scope and covered descendants, never at an ancestor; failure leaves the new Error there. Guard completion changes state only when its barrier is still current.

## Scope

External ordering exposes one bulk scope-entry boundary. Async control flow uses it directly; common invocation and external property operations consume it without embedding guard logic in graph walkers. `initializeContext` is the only writer of fixed-path facts. The design adds one external-only context guard tree, no per-path Chain, no second importer, no authority transfer, and no managed-call behavior.
