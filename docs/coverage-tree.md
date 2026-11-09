# Runtime coverage and simplification search

Updated 2026-11-06 against the current runtime and working-tree changes. The last
full compilation was `4f0849d` (2026-10-03); `d47332b` (2026-10-22) adjusted two
leaves and `0026794` (2026-10-27) changed two migration notes. This update includes
the intervening implementation and review work, rather than only changes after
that last edit.

The coverage tree describes **responsibilities**, not mandatory modules or
separate mechanisms. A leaf's presence is not a claim of complete verification.
Different responsibilities may share one implementation; showing that both are
necessary does not establish that today's separate implementations are necessary.
[Data limitations](data-limitations.md) remains the production contract. Selected
future work is listed separately below.

## Current functionality and correctness responsibilities

- Current runtime
  - C01 — Execution and public integration
    - Execution isolation
      - Execution configuration and local graph-state isolation
      - Chain binding and cross-execution operation rejection
      - Export-import transfer between executions
      - Host-guaranteed non-overlapping mutable-resource reuse across executions
    - Operation contexts
      - Immutable execution and opaque source-context propagation
      - Context preservation through nested and deferred work
    - Public runtime composition
      - Native ESM loading and public export compatibility
      - Guarded semantic entry, continuation, and host-action composition
      - Higher-runtime result admission and single completion ownership
      - Trusted compiler/control facts versus supported application-input validation
  - C02 — Asynchronous progress and operation completion
    - Ordered availability
      - Immediate available progress and non-blocking issuance
      - FIFO continuations and sequentially equivalent effects
      - Supported thenable consumption and returned-transition readiness
      - Error, Function, and admitted-category precedence
      - Required dependencies may remain pending; no invented timeout or later-work prerequisite
    - Required input coordination
      - Ordered input capture and complete required-outcome collection
      - Required completion frontiers versus independent result data
    - Outward completion
      - Ready results and pending boundary-processing equivalence
      - Required publication versus issuance-result completion
      - Pending fatal-result registration through final settlement
    - Local work and Promise lifetimes
      - Idempotent owner closure and nested-resource release
      - Shared settlement independent of closed local work
      - Source and aggregate release after last required access
      - Consumed-source and derived-Promise rejection ownership
      - Source-free output discard while required Error collection continues
      - Iterative history-sized completion and release within the synchronous transition
  - C03 — Data classification, configuration, and reception
    - Host declarations
      - Shallow external identity declarations and precedence
      - Atomic reachable managed-state declarations
      - Exact managed-class registration and prototype eligibility
      - Synchronous validation, idempotence, and declaration conflicts
    - Identity admission
      - Execution-local category and admitted-prototype fixation
      - Required structural classification failure, poison, and explicit external declarations
      - Imported-origin protection and unchanged host storage
    - Common input preparation
      - Fresh logical topology before receiver or target waits
      - Atomic admission, placements, versions, and topology activation
      - Alias and cycle preservation with borrowed-child protection
      - Deferred preparation segments and staged publication authority
      - Prepared-input reuse and unused-root abandonment
      - Failed identity inspection reused across delivery segments without retaining failed sources
      - Cached retired-input reactivation from logical state without reinspection or resubscription
    - Host-result reception
      - Causal result import and boundary capability validation
      - Prepared-result preservation of value, origin, identity, and existing producer
      - Fresh-wrapper preparation stops at prepared references; newly owned deliveries retain their boundary policy
      - Native receiver finalization and independent result-admission failures remain separate
  - C04 — Language graph access and mutation
    - Chain roots
      - Root initialization and retained-holder semantics
      - Empty-path replacement and ordinary versus entered deletion
    - Graph properties
      - Own enumerable data placements and excluded property surfaces
      - Absent placement versus present undefined
      - Terminal-value capabilities and broken traversal prefixes
    - Path selection
      - Reached-only String and Number validation without coercion or unused-suffix access
      - Ready, synchronous, native-Promise, and ordered-thenable keys share consumption and normalization
      - Rejection and PoisonedValue propagation before successful-key validation
      - Ordered root and intermediate-placement capture
      - Canonical path rebasing and source-static provenance
      - Promise keys narrow static provenance before consumption; normalized keys never regain authority
      - Inner protection before outer prefix release; unrelated siblings proceed after selection
      - Target handoff ends selection protection independently of pending method/result completion
    - Assignment and deletion
      - Right-hand reception before destination mutation
      - Final creation, replacement, and deletion without old-value consumption
      - Selected mutation scope and deterministic failed-prefix placement
      - Managed and native boundary selection along the path
  - C05 — Logical placement state and publication
    - Property versions
      - Captured value, presence, recovery, and insertion position
      - Independent pending versions and ready logical overlays
      - Installed authority versus detached captured settlement
      - Producer publication readiness distinct from source availability
      - Version copying and independent outstanding-use retention
      - Shared copied delivery with independently active destinations and historical captures
      - Copied-delivery release, late settlement, and reactivation without duplicate subscriptions
    - Managed publication
      - Own-data-property creation and restricted-storage materialization
      - Placement-value validation and native Promise-resolution safety
      - Record insertion order through creation, deletion, and recreation
      - Atomic storage, parent, index, recovery, and structural updates
      - Required write failure versus optional physical synchronization
      - Stale physical fallback exclusion and writer-authority release
      - Canonical Array backing producers and live-owner publication projections
      - Recovery, property presence, and record order settle with their captured version
    - Transition gates
      - Pending mutation privacy and ordered placement access
      - Pending property-prefix transitions and gate handoff
      - Entry write-through and deep prefix completion without history-sized recursion
  - C06 — Managed ownership, retention, and retirement
    - Owner isolation and copy-on-write
      - Incoming-owner and protected-ancestor preservation
      - Imported and recovery-baseline write protection
      - Shallow path copying with off-path reuse and prototype preservation
      - Aliases and cycles within one owner versus independent occurrences
      - Protection copies preserve logical identity; native receiver preparation always assembles detached copies
    - Retained uses and handoff
      - Read leases protecting values without delaying mutation
      - Holder and pending-writer pins preserving graph liveness
      - Bounded ready-result delivery and shared fallback release
      - Direct pending-result reception before producer release
      - Forwarding and joining independently protected inputs
      - Unpublished working-root protection and ownership transfer
      - Detached delivery cleanup in live and failed executions
    - Complete parent relationships
      - Root, alias, cycle, and projected Array-backing occurrences
      - Incremental placement attachment, replacement, and removal
      - Recovery dependencies and logical versus physical relationships
    - Retirement and reactivation
      - Graph-transition batching across nested callbacks and trusted bodies
      - Synchronous disconnected-region retirement including cycles
      - Reverse links, backing registrations, destinations, and counter release
      - Authoritative forward-state restoration without host reinspection
      - Active-descendant reuse and demand-driven counter rebuilding
    - Bounded graph work
      - Selected-input, path, frontier, and dependency work limits
      - Identity inspection without losing placement occurrences
      - Incremental maintained facts without active-graph rescans
      - Pending-copy, pending-push, selection, and retained-history work measured separately from output size
    - Publication-derived identity and canonical assembly
      - Effective writes separate identity, including equal-value writes; nonpublication preserves it
      - Source-free identity keys and pending publication cells across ancestor and entry changes
      - Bounded representative forwarding, comparison waits, and iterative nested completion
      - Data readiness, shape readiness, and alias-partition readiness are distinct dependencies
      - Shared captured-graph construction and assembly for exports, native receivers, and external snapshots
      - Inspect every required physical representation even when logical identities alias; canonicalization cannot suppress reflection failures
      - Fresh snapshot identity domains preserve captured alias decisions without delaying unrelated managed access
  - C07 — Errors and recovery
    - Failure data and attribution
      - Missing leaf sources supplied by reception without changing shared diagnostics
      - Native Error recognition and poison versus fatal classification
      - Successfully supplied native Errors are healthy opaque data; causal throws/rejections produce poison
      - Immutable contextual wrappers and stable semantic failure kinds
      - Causal source preservation across ready and pending boundaries
      - Hook-free diagnostics retaining exact compliant causes
      - Flat compound unions and semantic leaf deduplication
      - First actual import preparation fixes source and derived diagnostics; poison presence stays deterministic
      - Unspecified collected-poison order and first-encountered fatal selection are narrow diagnostic exceptions
    - Fatal execution failure
      - First authoritative fatal commit and best-effort reporting once
      - Unexpected trusted escapes versus causal external failures
      - Prompt pending-result failure and settled-result stability
      - Fatal checkpoints suppressing later graph and host effects
      - Cross-execution fatal reception and independent live executions
      - Synchronous external-action re-entry exclusion
    - Managed scope poison
      - Ordered baseline retention and failed-working-state discard
      - Blocked-operation propagation without changing data or own status
      - Ordinary Error data versus repairable placement poison
      - Receiver publication failure and independent result Error preservation
    - Repair
      - Managed own-status clearing and failed-publication preservation
      - Ordered external own-status clearing with descendants preserved
      - Ancestor poison, readonly restrictions, and failure-preserving managed/metadata commit
      - Repair-only neither consumes the retained payload nor waits for overwritten external poison
      - Repair-and-call preflights structural scope before clearing, then consumes the restored receiver
      - One combined issuance position and final publication; failed calls cannot resurrect cleared poison
      - Terminal managed aliases repair their placement without clearing canonical resource metadata
  - C08 — Error queries and graph presence indexing
    - Error query results
      - Existence proofs and early hasError completion
      - Complete getErrors collection over captured Promise frontiers
      - Terminal managed guards and opaque external identities
      - A selected managed guard stops graph traversal but does not suppress its canonical metadata union
      - Ordered contextual external poison snapshots without native reads or native reservations
      - Computed canonical metadata selection without native-access authority
      - Terminal alias opacity versus forbidden traversal through an off-path resource alias
      - Recoverable query reflection failure versus internal traversal fatality
    - Lazy presence index
      - Atomic downward-closed index construction and abandonment
      - Cycle-cut projection preserving language topology
      - Immediate-placement multiplicity and zero/nonzero propagation
      - Incremental indexed-child publication and reciprocal edges
      - Counter-pruned traversal with shared cut-region visitation
  - C09 — Expression extraction
    - Primitive-only extraction without coercion or descendant traversal
    - Ready immutable failure containers and pending Error rejection
    - Expression-failure consumption into ordinary graph Error data
  - C10 — Reference entry
    - Reference capture
      - Narrowest selectable anchor with an unconsumed relative suffix
      - Optional discovery failure at the enclosing placement
      - Original destination and complete recovery-state transfer
      - Deferred suffix keys retain original dynamic provenance without eager consumption
    - Access protection
      - Managed mutable gates with ancestor copy-on-write
      - Readonly captures and contained mutation restrictions
      - Mixed and external coverage before callback activation
    - Entry completion
      - Callback-result reception before protection release
      - Closure of new issuance with surviving contained and nested work
      - Private-root publication and holder-mirror detachment
      - Managed publication independent of external descendant completion
      - Entry-private metadata histories publish without waiting behind later outside work
  - C11 — Invocation and language conversion
    - Call dispatch and inputs
      - Receiver capabilities, method availability, constructor exclusion, and mode
      - Declared input consumption, omission, and unused-input abandonment
      - Receiver protection before callback-capable argument preparation
      - Clean receiver and argument coordination before dynamic member resolution
    - Managed receiver preparation
      - Complete logical capture with aliases, cycles, presence, and shape
      - Opaque external leaves and full-receiver capability restrictions
      - Required receiver and argument Error collection
      - Record own-method and admitted class-prototype selection
      - Observation materialization from captured logical state
      - Dispatch and determined argument/range failure before otherwise irrelevant native alias assembly
    - Managed mutation
      - Complete receiver isolation from baseline and exported arguments
      - Completed receiver validation and produced-state admission
      - Receiver finalization independent of method-result admission
      - Returned receiver publication versus independent imported results
      - Transactional fresh admission and topology adoption after complete receiver validation
      - Newly stored exported arguments gain imported protection because host code may retain them
    - Receiver and exact-input authority through direct method completion
    - Native Strings
      - Character-index and intrinsic-length observations with write restrictions
      - Trusted data-method dispatch and native observation behavior
      - Exported arguments, native protocols, callbacks, and result admission
    - Logical scalar conversion
      - Intrinsic primitive conversion without application coercion hooks
      - Recursive Array joining with captured ancestry, shape, and complete Errors
  - C12 — Logical Arrays
    - Controlled methods
      - Controlled method table and observation-mutation result semantics
      - Sparse remapping versus dense read-through-hole copying
      - Retained payload insertion, replacement, and movement
      - Receiver publication and independent removed-value results
      - Native callback inputs share one detached graph; synchronous callback-result validation
    - Selection and composition
      - Indexed sampling with normalized bounds and captured results
      - Range copying with captured presence and bounded source access
      - Concatenation spreading and scalar payload retention
      - Depth-limited flattening with required frontier and cycle handling
    - Search and sorting
      - SameValueZero membership and concurrent pending comparisons
      - Ordered strict-equality searches and early termination
      - Stable default-key sorting with holes and undefined
      - Synchronous comparators over one detached shared snapshot
      - Search identity captured before later equal-value, self-copy, or effective range writes
      - Promise-key prefix gates preserve earlier search identity and release unrelated siblings
      - Delayed search inputs retain the issued Array across later append, overwrite, deletion, splice, and resize
    - Length and structural ordering
      - Intrinsic length observations and resize-value conversion
      - Retained-prefix resizing and truncated-transition exclusion
      - Committed growth independent of element completion and backing resize
      - Exact-length and range questions at captured program positions
      - Captured shape histories and watcher release
      - Fork-specific invalidation, dominated-contribution compaction, and last-question release
    - Array storage representations
      - Logical bounds, holes, overlays, and projected storage
      - Shared-backing derivation and protected endpoint reuse
      - Eligible in-place storage versus copy or materialization
      - Canonical backing producers shared by copies, overlays, parents, and counter projections
      - Selected-range fill/copyWithin work with complete failure baselines
      - Bounded moving-queue storage and release of discarded prefixes
  - C13 — External state and authority
    - Static context registration
      - Finite named-route discovery and managed-endpoint pruning
      - Direct original placements; Promise/thenable origins stop discovery without subscription or resumed registration
      - Atomic binding registration and duplicate selected-location rejection
      - First valid registration survives rejected duplicate contexts and canonical-location collection
      - Fixed runtime trees and unchanged compiler-owned input
    - Context-bound authority
      - Canonical and entered routes with preserved static provenance
      - Inert aliases, local off-path rejection, and competing bindings
      - Fixed resource identities and connecting namespace preservation
      - Mixed managed-scope rejection with permitted inert-alias retention
      - Native traversal and receivers excluding managed mutation authority
      - Reached-prefix validation and deterministic dynamic-selection failure scopes
      - Metadata-only computed selection versus source-static native authority
      - Late first-registration checks cover retained roots and intermediate identities as well as receivers
      - Revision-gated authority revalidation after key, data, argument, and external predecessor waits
    - Hierarchical effect ordering
      - Overlapping observations and ancestor-descendant mutation conflicts
      - Issuance-time reservations and fixed managed prerequisites
      - Bounded reservation frontiers and idempotent completion
      - Private entry views without dependence on later outside work
      - Direct-boundary lifetimes and early-failure predecessor draining
    - Native operations
      - Ready native traversal with availability only at final results
      - Ordered property reads and observation-only result import
      - Export-before-write assignment and native deletion
      - Prepared native member selection, invocation, and result import
      - Mutation failure retaining completed host effects
    - Mutable-property snapshots
      - Detached ready-only graph copying and completed-copy admission
      - Logical managed placements and Array shape through native aliases
      - Snapshot validation and complete discoverable Error collection
      - Release native observation after data capture, before alias-partition or later argument waits
      - Managed snapshot adoption can precede alias resolution; complete native export resolves canonical aliases
    - External scope poison
      - Persistent sparse metadata versions separate from host-effect reservations
      - Lazy selected-component futures, bounded forwarding, and source-free history release
      - Issuance-time snapshots preserve earlier pending outcomes across later resets
      - Selected own-status clearing overwrites its pending outcome while preserving descendant futures
      - Computed-path selection narrows metadata capture without quadratic failed-selection history
      - Settled-empty collapse and reuse without repeated descendant scans
      - Ancestor blockers with healthy sibling availability
      - Local observation failure without changing mutation poison
  - C14 — Host-ready data export
    - Detached managed copying with admitted prototypes and exact opaque leaves
    - Shared aliases and cycles across ordered input batches
    - Captured placements and structure through pending completion
    - Complete root Error collection before native effects
    - Mutation-capability escape prevention across outward routes
    - Partial-output release independent of required Error collection
    - Canonical native assembly waits only for required shape and identity partitions
    - Discard releases identity keys, domains, shells, and successful leaves as well as source captures
  - C15 — Verification and review tooling
    - Semantic reference models
      - Independent managed placement, Array, and nested-graph sequences
      - Input-reception and graph-lifetime models
      - External scope effects and ordering models
      - Retirement algorithms against independent forward-root reachability
      - Native-equivalence comparison of values, effects, and structure
      - Error attribution, cause, and identity oracles
      - Promise-key differential histories with failed keys, later queries/repair, and fixed provenance
      - Imported-Promise path, receiving/invocation, and retirement/re-entry joint histories
    - Structural and lifetime witnesses
      - Independent parent, storage, counter, and liveness oracles
      - Publication, construction, admission, and work-bound instrumentation
      - Garbage-collection and retention witnesses
      - Unformatted Error retention at multiple stack depths, with live-result controls
      - Pending-copy/push, selection metadata, native authority, and deep completion work counters
    - Execution controls and verification sensitivity
      - Exhaustive conflict schedules with independent ordering witnesses
      - Ordered-thenable fixtures preserving the scheduling contract
      - Safeguard fault injection and witness classification
      - Deterministic seeds, coverage dimensions, and observer-free controls
      - Bounded child-process execution and strict rejection handling
      - Windows module-URL normalization and loader-order/worker instrumentation receipts
      - Stale, uninstrumented, timed-out, and non-assertion fault runs are not safeguard evidence
      - Design/prototype probes remain distinct from integrated production coverage

## Evidence for the refreshed branches

These are entry points for checking the additions, not a second exhaustive test catalogue.

| Coverage | Current implementation / contract | Representative evidence |
| --- | --- | --- |
| C03, C06, C11, C14: prepared results, identity, common assembly | [Receiving contract](data-limitations.md#method-results), [identity](../src/captured-identity.js), [capture and assembly](../src/managed-capture.js) | [Method-result identity](../test/method-result-identity.test.js), [snapshot identity](../test/snapshot-identity.test.js), [output identity release](../test/fixtures/capture-output-identity-release.mjs) |
| C05, C06, C12: backing producers, copied delivery, bounded storage | [Property versions](../src/property-versions.js), [Array backing](../src/array-view.js), [range remaps](../src/array-remap.js) | [Pending push](../test/pending-push-work.test.js), [pending copy](../test/pending-copy-work.test.js), [range recovery](../test/array-range-recovery.test.js), [queue storage](../test/array-history-storage.test.js) |
| C04, C10, C12: Promise keys and selection handoff | [Path protocol](promise-path-segments.md), [route consumption](../src/path-context.js), [mutation traversal](../src/mutations.js) | [Promise paths](../test/promise-path-segments.test.js), [search ordering](../test/array-search-ordering.test.js), [Promise-key differential](../test/fixtures/promise-key-differential.js) |
| C07, C08, C13: versioned metadata, repair, canonical authority | [External ordering](external-context-ordering.md), [metadata versions](../src/external-metadata.js), [external access](../src/external-access.js) | [Metadata histories](../test/external-metadata.test.js), [repair-and-call](../test/repair-call-recovery.test.js), [binding diagnostics](../test/external-binding-diagnostics.test.js) |
| C02, C03, C06, C15: imported-data/key interactions and lifetime | [Imported-Promise review](phase5-review.md), [receiving ownership](data-limitations.md#managed-results-and-receiving-boundaries) | [Joint interactions](../test/imported-path-interactions.test.js), [path lifetime/work](../test/fixtures/imported-path-lifetime.mjs), [receiving differential](../test/fixtures/receiving-invocation-differential.mjs) |
| C15: trustworthy verification | [Test guide](../test/README.md), [safeguard evidence](../test/safeguards/evidence.mjs) | [Loader evidence](../test/runtime-loaders.test.js), [safeguard evidence tests](../test/safeguard-evidence.test.js) |

## Selected future work — not current runtime coverage

The [iteration plan](../iterate-plan.md), [Array layout design](../array-layout-approaches.md),
[method specification](array-method-specification.md), [Chain modes](../poison-policy-plan.md),
and [repair revision](../repair-simplification-plan.md) select a future architecture.
Their design probes do not establish production implementation or acceptance.

- F01 — Captured iteration and partial Array publication
  - One query boundary for shape, presence, source selection, membership, poison, and required effects
  - Correlated controls and selector/endpoint reductions before waiting or propagating failure
  - Persistent block layouts using selected Variant B; compact ordinary Array/ArrayView cases
  - Restricted source captures and progressive release of consumed regions
  - Query-specific notification and bounded composition of mixed histories
- F02 — Chain modes and regional failure
  - Complete, sequential-stream, and unordered-stream behavior
  - Payload poison, structural poison, positional status, and missing-output markers
  - Deterministic fallback preserving already published facts and required effects
  - Root validity before copy-result handoff; independent receiver and direct-result outcomes
- F03 — Captured Array cursors and open append entries
  - Element Chain handoff, unread-input preservation, self-modifying loops, and cursor closure
  - Unordered occurrence discovery with separate position availability
  - Push-only entry authority, overlap, reserved contribution order, and private-prefix reads
  - Nested completion, capacity, and control-flow failure markers
- F04 — Status-only repair
  - Clear selected own status on current data without restoring a repair-only predecessor
  - Exact-own external clearing while historical captures and descendant status remain unchanged
  - Preserve native receiver isolation, imported protection, retained snapshots, and ordinary COW
- F05 — Integration and replacement
  - Migrate controlled methods and indexed/length/path consumers through the same query boundary
  - Remove superseded production paths at each cutover rather than retaining two engines
  - Verify current-contract migration separately from the new semantics and design prototypes

## Simplification search tree

Use C01–C15 as the **coverage axis** and the branches below as the **implementation
search axis**. Searching each existing module in isolation tends to preserve the
historical architecture. These branches deliberately cut across modules and
follow the same fact from capture through publication, observation, and release.

The implementation searches below are hypotheses, ordered by likely
structural payoff. The review status table records implemented replacements and
evaluated alternatives; unimplemented alternatives remain open hypotheses.
The future contracts listed under F01–F05 remain selected; their implementation
and simplification benefit still need evidence. The first review's small local
edits do not close these branches. Different lifetime, failure, or ordering
requirements must remain expressible, but can be states or outcomes of one
mechanism rather than reasons to retain parallel engines.

- S1 — One captured-data and logical-producer model (C02, C03, C05, C06, C11, C12, C14)
  - S1.1 — Share graph capture, not just final assembly
    - **Implemented:** `ManagedCapture.walk` constructs both ordinary managed captures and snapshots; `SnapshotCapture` supplies concrete ready-only source reads. The separate `captureExternalValue.walk` and its visited/output/source-disposal path are removed. Capture now owns output assembly/disposal directly; the single-use `CapturedGraph` base and module are removed.
    - Consumption of availability versus rejection of unavailable snapshot data remains at the readers. Receiver adoption and fresh input preparation still publish their own admission transactions.
    - Further sharing must remove an actual traversal or protocol, not wrap the remaining admission transactions in policy callbacks.
    - Preserve per-representation inspection, required Error collection after output discard, snapshot no-subscription, source release before alias assembly, and fresh admission's transactional commit.
  - S1.2 — One logical producer with independent destination uses
    - Compare copied delivery, canonical backing producers, construction destinations, pending captures, and placement transition publication in `property-versions.js`, `array-view.js`, and `parent-placements.js`.
    - Try one source/version record whose destination uses own activation and publication authority, instead of translating through separate delivery families.
    - Deletion target: an entire producer adapter family and its retain/release/refresh machinery, with no compatibility path left behind.
    - Preserve FIFO operation subscriptions, detached historical captures, failed optional writeback, independent retirement, and linear pending-copy/push work. Do not introduce a global subscription queue.
  - S1.3 — One captured-placement query boundary
    - Compare `PropertyPlacement`, Array remap preparation, `ManagedCapture`, shape capture, and future F01 queries.
    - Try shared capture of presence/source/shape facts, with explicit consumer demands for values, identity, or complete Errors.
    - Deletion target: repeated placement-resolution, subscription, and source-retention loops in capture and Array preparation; avoid a second query wrapper around all existing loops.
- S2 — One managed publication outcome and commit protocol (C04, C05, C06, C07, C10, C11, C12)
  - S2.1 — Replace overlapping mutation result forms
    - **Implemented:** managed outcomes carry one complete `placement`, an independent `result`, and their publication fact. `mutatedValue`, fallback placement reconstruction, `captureMutationResult`, and caller-specific scope adapters are removed.
    - `PathOperation.mutate` captures nested scope outcomes centrally. Normalization distinguishes new failure from stored poison data; native blockers remain result-only.
    - Preserve absence/order/recovery, independent-result timing, publication-failure aggregation, and publication's own release point.
  - S2.2 — Make one transition own all effects of a placement commit
    - Map storage, structure, logical parents, counters, recovery, identity, and entered-holder mirroring across the existing commit helpers.
    - Test whether one prepared transition can derive those updates from one before/after capture, removing repeated preflight and reconstruction.
    - Deletion target: duplicate commit preparation/authority state, not a new coordinator that calls every old layer unchanged.
    - Required storage failure and optional cache synchronization remain different outcomes; neither may silently bypass supported Proxy failure semantics.
- S3 — One captured-location selection protocol (C04, C05, C08, C10, C13)
  - S3.1 — Unify reached-prefix and key progression
    - Compare `walkObservationValue`, `walkMutationPath`, `ExternalAccess.walkPrefix`, and entry's available-prefix discovery.
    - Try one cursor carrying the captured location, normalized-key position, and route; keep mutation reconstruction only for operations that need it.
    - Deletion target: parallel key continuations, route advancement, prefix capture, and source-clearing recursion. A dispatcher over unchanged walkers does not qualify.
    - Preserve optional entry discovery, exact failure placement, source-static provenance, inner-before-outer gate handoff, sibling progress, and native ordering before live reads.
  - S3.2 — Derive authority and metadata selection from that same consumed route
    - Inventory operation-local copies of path depth, canonical node, dynamic provenance, selected scope, and metadata capture across `PathOperation`, `ExternalAccess`, and entry.
    - Remove re-derivable route state and duplicate selection adapters; retain distinct native-access and metadata-only permissions.
- S4 — One Array mapping and shape engine (C05, C06, C12; future F01–F03)
  - S4.1 — Replace competing construction carriers
    - Compare eager remaps, direct selected-range output, derived views, dense-presence preparation, and materialization (`ArrayRangeRemap` has been removed); evaluate the selected persistent layout as a replacement.
    - Deletion target: old remap/range carriers and duplicated view/remap dispatch for migrated families, not an additional layout engine beside them.
    - Separate current-semantic refactoring from the planned pending-control and regional-failure cutover. Preserve sparse holes, selected-range work, and callback/native boundaries.
  - S4.2 — Represent captured shape once
    - Compare `LengthState` contribution/question histories, captured shape handles, and proposed layout count transforms.
    - Test one captured shape mechanism with a numeric fast path, replacing linked length history and fork-specific bookkeeping where the same facts suffice.
    - Preserve exact readiness separately from bounds, old questions across later growth, and bounded notification/compaction. Do not retain both old length history and a new layout history indefinitely.
  - S4.3 — Share demand/capture machinery across Array consumers
    - Compare search, join, sort preparation, flat, export, and future cursors before their result-specific reductions.
    - Deletion target: repeated traversal/subscription/retention coordination. `includes`, ordered search, and complete collection can keep different reducers without separate capture engines.
- S5 — Forwarded facts and historical completion (C02, C05, C06, C08, C13)
  - Compare source-free forwarding, path compression, consumer transfer, worklists, and closure in `captured-identity.js` and `external-metadata.js`; compare length/placement histories only where the same transition occurs.
  - Test whether a narrow common forwarding primitive removes a whole duplicate completion protocol while identity equivalence and metadata-tree replacement remain domain operations.
  - Deletion target: repeated representative/signal-transfer state and drains. Reject a general future framework with more policies than the code it replaces.
  - Preserve synchronous delivery, bounded deep histories, historical snapshots, and immediate last-use release; no scheduler or extra microtasks.
- S6 — Ownership projections and resource lifetimes from canonical facts (C02, C05, C06, C08, C11, C14)
  - S6.1 — Consolidate maintenance of graph projections
    - Map incoming placements, backing occurrences, counter edges, flagged data, and publication destinations back to the logical fact each represents.
    - Test one edge/placement transition as their maintenance source, with projections only where a distinct query or measured work bound requires them.
    - Deletion target: duplicate edge-update protocols and duplicated retained facts. Distinct topology and counter semantics alone do not prove today's separate maintenance paths are minimal.
    - Preserve cycles, multiplicity, optional index construction, inactive-region restoration, and no active-graph rescans.
    - The [earlier shared relationship-record experiment](runtime-evolution-plan.md#9-experiment-decisions) did not simplify the implementation. A new candidate must identify a different invariant and concrete maintenance it removes; that rejected prototype does not close this branch.
  - S6.2 — Make captured input/output records own their resources
    - Trace receiver, arguments, successful output, identity records, leases, writer pins, and release registries through one pending call and one failed export.
    - Test whether source-free records can eliminate operation-specific release hooks and parallel strong references while keeping their actual last-use points.
    - Deletion target: duplicated ownership fields and cleanup paths; do not merge lifetimes merely to reduce the number of release functions, or introduce a cancellation system.
- S7 — Explicit semantic cutovers and contract decisions (cross-cutting)
  - S7.1 — Execute the selected status-only repair cutover (F04)
    - D01 removes repair-only predecessors and preservation links. Operation-local baselines, including controlled Array range captures, remain necessary for current mutation atomicity; streaming changes to that contract remain separate. Ordinary retained snapshots and native receiver isolation remain.
  - S7.2 — Evaluate registration-before-first-use as a narrower host contract
    - Deletion target: retained noncanonical identity sets, registration revisions, and post-wait revalidation. Keep canonical authority and duplicate-registration rejection.
    - This deliberately removes supported late-registration behavior; do not label its current checks misuse defenses.
  - S7.3 — Evaluate canonical logical storage versus physical managed writeback
    - Ask whether physical source storage can become an import/native-boundary detail rather than a second managed mutation representation.
    - Potential deletion target: storage/overlay reconciliation, representation preflight, and physical write-through branches.
    - First resolve the observable required-storage/Proxy failure contract. Eliminating a host write can eliminate a promised failure; this is not automatically a semantics-preserving refactor.
- S8 — Delete residual flexibility after structural consolidation (C01–C15)
  - Remove unused adapter formats, policy branches, compatibility paths, duplicated caches, and test scaffolding for removed implementations.
  - Audit trusted control validation separately from application/reflection failure handling; remove only costly defenses for excluded misuse.
  - Keep independent semantic oracles and fault sensitivity. Tests of a replacement must not merely mirror its internal representation.

### Structural review status

These conclusions apply to the specific alternatives examined, not every design
in a branch. [The review record](../simplifications.md#structural-review--2026-11-05)
contains the state flows, deletion targets, counterexamples and verification.

| Branch | Status and evidence |
| --- | --- |
| S1.1 | Kept: one real graph-construction walker with concrete managed/snapshot readers; duplicate snapshot construction removed. |
| S1.2 | Open: backing producers already use ordinary placement-version publication. Collapsing copied delivery into mutable source versions loses historical delivery; a smaller source/destination model is unproven. |
| S1.3 / S4.3 | Evaluated, no replacement kept: eager shared graph capture would inspect unused search/flattening data; a demand dispatcher would keep the old reducers and add policies. |
| S2.1 | Kept: one placement outcome and centralized nested-scope capture; poison assignment and mutation failure remain distinct. |
| S2.2 | Kept: shared forward version state and one placement activation path. Storage, structure and optional counters already derive from one prepared commit; a larger transition record would only package those callbacks. |
| S3.1 | Reverted prototype: merged native/managed observation progression added mode, terminal-authority and lifetime branches without a clearer path. Mutation reconstruction and non-consuming entry discovery remain explicit. |
| S3.2 | Evaluated: consumed route already supplies normalized keys, depth and canonical nodes. Issuance scope and dynamic provenance cannot be recomputed from the final selected node. |
| S4.1–S4.2 | Kept: direct range construction removes the range carrier; views/ranges/remaps share one output finalizer. Dense remap unification still loses selected-range work; persistent layouts remain future implementation work. |
| S5 | Kept: metadata consumption transfers one final state/callback; removed recursive reconsumption and ancestor collection's separate completion/cleanup. Identity/metadata generic forwarding still retains different wake rules. |
| S6.1 | Kept: one forward placement Map replaces mirrored version/ownership stores; initialization mirroring is removed and activation is shared. Counter projections remain because ordinary occurrence expansion scans unrelated Array owners. |
| S6.2 | Kept: one staged identity record replaces paired import maps; optional method diagnostics have no carrier; reservations derive memberships from the retained route. Source, publication and output last-use points remain distinct. |
| S7 | Needs contract decisions: status-only repair, registration-before-first-use and logical-only managed storage change supported behavior. No semantic cutover was made. |
| S8 / C15 | Kept: one exact-source instrumentation and load-receipt protocol replaces twelve fixture loaders; independent counters and disabled controls remain. |

The [implementation-wide review](../simplifications.md#implementation-wide-review--2026-11-06) records concrete coverage across all runtime responsibilities, retained replacements, disproving cases and the combined verification record. The first structural pass's assertion that larger changes needed a contract decision was withdrawn.

## How to work this search tree

1. Start with S1–S3 as one connected investigation of capture, selection, and publication. Trace an ordinary assignment, a managed call, an external snapshot, and entry through those boundaries before designing replacements. Continue to S4–S6; keep S7 decisions explicit.
2. For each candidate, write the current fact/state flow, the smaller proposed invariant, the exact old structures to delete, affected C branches, and a counterexample that would disprove the design. A rewrite is appropriate when it removes several mechanisms; file size is not a reason to preserve the old structure.
3. Mark a candidate **open**, **prototyping**, **kept**, **reverted**, or **needs a contract decision**, with evidence. Do not mark a branch exhausted because its small helpers were inspected or its tests pass. A rejected candidate does not reject all designs in that branch.
4. Implement a coherent batch through all affected producers and consumers, removing the superseded path in that batch. Assess each edit for clarity as it is made. Batch focused tests, then run broader required checks after the design settles; do not run the full suite after each small edit.
5. Judge total complexity: concepts/states, independent lifetimes, duplicated traversals, representations, adapters, and runtime code removed versus added. Fewer lines that hide more obligations or add policy flags are a loss. Passing tests establish compatibility, not simplicity.
6. Record unresolved contract decisions in [simplifications.md](../simplifications.md). Update this map when a mechanism actually disappears; keep coverage responsibilities even when one implementation now serves several branches.
