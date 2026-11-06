# Simplification review

Reviewed 2026-11-05. Current behavior remains governed by
[data limitations](docs/data-limitations.md). This first pass inspected the runtime
and made local reductions, which were reviewed and tested. It did not adequately
challenge the existing architecture and does not establish that substantial
simplifications are exhausted. The refreshed
[coverage and simplification search tree](docs/coverage-tree.md#simplification-search-tree)
defines the still-open structural investigation across module boundaries.

## Structural review — 2026-11-05

The follow-up starts from the existing dirty tree and preserves the initial
changes below. C01–C15 are current responsibilities; F01–F05 remain future work.
The findings here concern implementations, not changes to those contracts.

### Capture construction (S1.1; C02, C03, C06, C11, C14)

**Kept.** Managed export/receiver capture and mutable-external snapshots
both recursively construct source-free node/edge records, track aliases and
cycles, collect failures, and discard output. They formerly implemented those
steps in separate walkers before using the same assembler.

The replacement gives both boundaries one graph-construction walk. Concrete
readers retain the differences in classification, keys, shape, placement reads,
and availability consumption. Snapshot validation remains synchronous and never
subscribes to unavailable data; leaf admission remains transactional. The
snapshot's recursive construction, visited/output table, and source-disposal
path disappear. That consolidation left `CapturedGraph` with one user, so its
output state, assembly and disposal were folded into `ManagedCapture` and the
obsolete base class/module removed. Output discard still leaves required Error
traversal active. Input preparation and native receiver adoption remain separate:
they publish admission and topology rather than construct captured output.

Counterexamples checked during design include equivalent physical
representations with different reflection failures, a failed source appearing
through several aliases, pending presence or shape in a snapshot, and discarded
output whose required Error collection remains pending. Deep unformatted Error
stacks exposed new reader-frame references during the prototype; those bindings
were cleared at the reader boundary rather than weakening lifetime assertions.

### Managed publication outcomes (S2.1; C04–C07, C10–C12)

**Kept.** Producers formerly returned both `mutatedValue` and an optional
`placement`, while commit reconstructed missing placement facts and callers
separately captured nested mutation scopes. The replacement carries one
authoritative placement alongside the independent result and publication fact.
`PathOperation.mutate` captures nested scope outcomes once; the separate
`captureMutationResult` helper and caller-specific adapters disappear.

A failed operation and successful assignment of poison are different outcomes.
The previous optional-placement convention encoded that difference implicitly.
A transient failure fact now identifies producer failure; normalization consumes
it while attaching recovery. Blocked native operations remain result-only and
do not invent a receiver publication. Publication releases its protection before
an independent pending result, and the final coordinator drops the completed
placement outcome before waiting for that result.

Disproving cases include stored rejected assignment data, repair selecting the
original placement unchanged, absent deletion and record order, publication
failure combined with an independent result failure, and an Array result that
outlives receiver publication. Existing semantic and lifetime witnesses cover
these boundaries; the first focused run caught the poison-data distinction.

### Observational/native cursor experiment (S3.1; C04, C08, C13)

**Reverted.** A working-tree prototype removed `ExternalAccess.walkPrefix`'s
recursive body and moved native progression into `walkObservationValue`.
It shared key continuations and property descent, but required native-mode
state through every read stage, different terminal-callback authority, extra
source clearing, and an additional continuation for native pending keys. It
removed almost as much code as it added and made the managed path depend on
native reception policy. It was reverted before tests; no passing-test claim is
made for it.

Broadening that cursor to mutation and entry would add reconstruction and
non-consuming discovery policies as well. A failed key must poison the reached
mutation prefix, while an unused entry suffix must neither consume nor validate
that key. A pending independent call result must not extend prefix protection.
The existing shared `consumeSegment` already owns normalization, consumed
position and route advancement. These counterexamples reject this prototype,
not every possible future captured-location representation.

### Instrumentation protocol (S8; C15)

**Kept.** Twelve work fixtures independently implemented loader routing,
line-ending normalization, source rewriting and load receipts. One narrow
`instrumentRuntime` helper replaces those loader implementations. Each fixture
still declares its exact counter edits and independent work assertions. Exact
anchor multiplicity, actual module-load receipts and disabled-loader controls
remain mandatory; a zero-work uninstrumented run cannot pass as evidence.

### Neighboring mechanisms evaluated

The completed replacements were followed through their neighboring mechanisms.
These findings reject particular alternatives, not entire search branches.

| Search | Smaller model examined | Evidence and remaining boundary |
| --- | --- | --- |
| S1.2: logical producers | Use the source version directly for every copied/backing destination. | Backing producers already use ordinary placement-version publication; their extra object projects physical indexes through live owner ranges. Copied delivery captures one completion independently of later source-version writes. Direct sharing would expose later value, presence or recovery to earlier copies. An immutable-version redesign must replace gate and mutation-version authority together; no complete protocol deletion was established here. |
| S1.3 / S4.3: consumer capture | Use one captured graph/demand traversal for remaps, searches, join, sort and flat. | All already reach the same guarded placement-subscription core. Eager complete capture inspects unused failing search positions and object interiors that conversion does not consume. Serial capture delays `includes` behind an earlier unknown comparison. Lazy presence, depth-limited flattening and complete Error collection would remain policies in a larger dispatcher. |
| S2.2: placement commit | Replace storage/structure/edge/counter callbacks with one transition record. | `preparePropertyCommit` already derives these updates from one before capture, reusing the required storage descriptor. Detached versions retain structural authority but no live topology authority. Optional cache writes and required writes already use the same commit with different failure contracts. Packaging the callbacks added retained source state without deleting a transition. |
| S3.2: route facts | Derive scope, provenance and metadata selection only from the final selected node. | The fixed issuance scope establishes ordering before keys settle; normalized keys cannot recover original dynamic provenance. Consumed depth and canonical nodes already live on one route. Earlier metadata views cannot be recaptured from current state after a wait. |
| S4.1: Array mapping | Replace eager remaps and selected-range carriers with one carrier. | A dense remap turns point fill/copyWithin into whole-Array work. A sparse range-plus-fallback carrier still needs baseline construction and adds representation dispatch. Replacing native intrinsic mapping needs a coordinated algorithm/layout rewrite, not an adapter. Persistent layouts remain future work with an unproven net reduction. |
| S4.2: captured shape | Replace length contribution/question lists with persistent maximum expressions. | Historical questions exclude later growth and forks share prior outcomes without unrelated invalidations. The expression alternative needs signal transfer, dominated-history compaction and release, recreating the existing machinery. Backward-settlement and retained-history witnesses disprove simple expression chains. |
| S5: forwarding | Share a union/find completion primitive for identity and metadata. | Identity comparisons can finish when pending classes merge; metadata consumers must stay asleep while their resolver chain transfers. A common completion framework retained both protocols behind callbacks. Sharing only the small compression loop adds an abstraction without removing the substantial mechanisms. |
| S6.1: graph projections | Derive counter propagation and retirement cleanup from incoming/forward placements. | One indexed child may be shared by many unindexed ArrayViews. Ordinary parent expansion scans unrelated owners; forward retirement scans repeated occurrences instead of distinct counter children. Retaining an Array-only cache creates another representation branch. A shared edge record remains possible, but no simpler representation preserving these work bounds emerged. |
| S6.2: resource holders | Use one generic holder for input, publication and outward delivery. | Arguments may outlive initial delivery; unused root preparation can close early; outward results preserve direct receiving reactions; placement captures transfer before independent results settle. The generic holder needs modes/extra hold states and eliminates no lifetime. S1 consolidates output disposal; S2 drops the completed publication outcome before waiting on its independent result. |

No costly unsupported-misuse defense was found to remove in these paths.
Application/reflection validation, source-static authority and execution-binding
checks protect supported behavior. Source rewriting tests remain strict about
their own instrumentation inputs; these are verification controls, not added
runtime interface defenses.

The first structural pass stopped too early. Its rejected alternatives did not
justify concluding that substantial current-semantic improvements required a new
producer/layout design or contract decision. The broader pass below supersedes
that conclusion; the earlier prototype results remain evidence only about the
specific alternatives tried.

### Structural verification

Focused publication-traced batches passed for capture, snapshot identity,
mutation/repair, publication failure and the shared instrumentation fixtures.
Fourteen affected capture/mutation/disposal safeguards detect violations,
including the new prototype-release fault. All 278 source edits in the 261-entry
safeguard registry match the final source. Independent review caught the snapshot
reader's prototype retention; five permanent GC cases now cover fresh/prebuilt
key and descriptor failures plus a healthy retention control.
Broad verification:

- Final normal suite: **6,187 passing**.
- All nine required enlarged checks passed with publication tracing and
  `CASCADA_SEQUENCE_SEEDS=1600`: preparation/lifecycle, placement, Array, nested,
  external, boundary, pending-boundary, receiving/invocation and Promise-key
  histories. Completed reports contain no failed or skipped cases. This includes
  12,800 pending-boundary tests and 305,600 receiving/joint histories.
- Final publication-traced suite: **6,187 passing**.
- Full publication-traced conflict matrix: **93,636 cases / 280,908 executions**,
  covering all 2,601 command triples and all three harness modes.
- Markdown relative-file links and `git diff --check` pass.

The normal suite was rerun after removing the obsolete capture module. Enlarged
semantic runs were retained across that code-only move; the final instrumentation
and fault checks target the new module locations. Interrupted development runs
are not counted as passing verification. No full publication-pair product is
claimed; its bounded default sample runs in both full suites, alongside the
independent generated models.

## Implementation-wide review — 2026-11-06

This pass reopened the review after the first structural pass covered too few
actual implementation paths. It followed issuance, admission, selection,
construction, publication, observation and release across all 43 runtime modules.
The earlier capture/outcome changes remain; this pass additionally removes the
following state and protocols without changing supported behavior.

### One authoritative forward placement table (S1.2, S2.2, S6.1)

**Kept.** Logical versions previously appeared in both `placementVersions` and
`outgoingPlacements`. Installation changed the first table; parent publication
mirrored each version into the second. Reactivation and retirement read one,
while logical reads, Array producers and counters read the other.

`outgoingPlacements` now owns each forward entry once. An overlay has an explicit
Boolean `present` fact; a physical traversable edge contains only `value`.
Logical access selects overlays from that table and still performs the required
host descriptor reads when no overlay exists. Array physical edges remain on
the backing record, so an Array owner's table contains only its overlays;
selected-range eligibility checks its size in constant time. Numeric overlay
enumeration remains ordered. Ordinary records already consume their key set
when combining physical candidates and overlays.

This removes the duplicated version store, its mirroring initialization walk,
and the consistency obligation between stores. Live publication and reactivation
share `activatePlacement`, including copied-delivery and recovery retention.
Optional counter edges, incoming occurrences and hidden recovery parents remain
separate projections: each answers a different bounded query, not another copy
of the same forward version table. The pending-append fixture counts the one
maintained store once and still independently counts parent links, owner visits,
subscriptions and captured memberships.

The prototype exposed an implicit-presence gate update; existing structural and
Array histories detected it. Version creation and updates now canonicalize
presence to a Boolean. Independent review also preserved recovery cleanup after
copied-delivery activation, since activation can synchronously publish a completed
delivery. Parent/storage verification still reconstructs expected data from
independent descriptors and bounds. No production test adapter was introduced.

### One staged identity record per import segment (S1, S6, S8)

**Kept.** Input preparation used separate admissions and containers maps for the
same identities, cross-checking membership during discovery, failure, commit and
disposal. One staged record now owns category facts and its optional construction.
Failure keeps facts available for authority discovery without committing a failed
container. Atomic segment publication, alias reuse and failed-inspection caching
remain unchanged.

Method-result preparation no longer has an always-on collection flag and
`{ errors }` carrier. Only receiver-failure combination and exact-receiver
rejection create the diagnostic Set they consume. Ordinary result preparation
without either consumer does not allocate it. Declaration and snapshot prototype checks share one retained-chain inspection;
the declaration stops on its first failure, while snapshots collect required later
failures. Two supported public tests cover that difference.

### One Array output publication path (S2, S4, S8)

**Kept.** Views, full remaps and range writes previously had separate output
completion paths, including an `ArrayRangeRemap` carrier and `instanceof` dispatch.
Range operations now construct their selected output at their own boundary;
all output forms use one finalizer for publication identity, receiver retention,
independent results and output failure. The carrier, its allocation and its
dispatch disappear. Eligible exclusive storage captures only the selected range;
shared or constrained storage still materializes the produced output. Full
structural methods continue to use remaps. Native removed-element and
length results retain their real result-specific adapters.

Backing extension also captures its ready logical length once instead of
repeating eligibility and shape reads through `tryShareStorage`. Pure guarded
reflection cannot change that captured shape or reenter runtime work.

### External ordering and metadata completion (S5, S6, S8)

**Kept.** External reservations no longer retain an auxiliary list of every
frontier Set containing them. Their immutable node/view route determines both
insertion and removal, with the same bounded ancestor work. Removing membership
releases that route independently of eventual effect completion. The exact
external-action guard uses structured `try/finally` instead of retained
success/failure slots.

Metadata consumption now transfers the captured final state and downstream
callback once, clearing both on local closure. Forwarded signals already wake
only on final publication, so recursively consuming/resubscribing after wake was
redundant. This lets ancestor collection drop its separate cleanup registration
and completion continuation. A pending-collector lifetime witness and live-owner
control cover the callback edge. A further prototype removed explicit metadata
capture cleanup; existing cases passed, but new compound-preflight failures
retained native resources through unformatted Error stacks. That prototype was
reverted, and both observation/mutation witnesses were retained. Context-tree
construction uses its maintained
child count rather than enumerating children to rediscover emptiness.

Error queries and mutation descent now retain the source version returned by
their placement read instead of looking it up again; the last redundant
`requirePromiseVersion` helper disappears. Its now test-only Promise projection
lives in the storage oracle, rather than remaining a runtime export.

### Concrete coverage and alternatives

| End-to-end responsibility | Code examined and outcome |
| --- | --- |
| Public issuance, execution, fatal completion | `index`, `chain`, `execution`, `internal-step`, `operation-result`, `operation-lifecycle`, `error`, `poisoned-value`, thenable recognition/subscription: retained the one outward pending fatal boundary; simplified external-action state. A combined operation/resource owner would conflate distinct last-use points. |
| Admission through native adoption | `import`, `input-preparations`, `language-values`, `meta`, `data-declarations`, `managed-invocation`: consolidated staged identities and diagnostic collection. A universal admission/receiver visitor would still require stop-at-prepared versus inspect-prepared and subscribe versus reject-unavailable policies. |
| Managed capture, snapshots and export | `managed-capture`, `external-snapshot`, `export`, `invocation`: retained the shared walker and assembler from the first pass; removed duplicate prototype inspection. Reader policies correspond to actual boundary differences, rather than independent construction engines. |
| Path selection through reconstruction | `path-context`, `path-operation`, `mutate-property`, `mutations`, `run`, `enter`, `external-access`: retained earlier complete-placement outcomes; reused exact captured versions. The prior native/managed cursor prototype was reverted because terminal authority and reconstruction remained separate behind added modes. |
| Placement publication and graph lifetime | `property-versions`, `language-properties`, `placement-structure`, `parent-placements`, `ownership`, `refcounts`: eliminated mirrored forward tables and initialization; shared activation. Replacing the acyclic counter projection with ordinary incoming expansion scans unrelated Array owners; replacing liveness proofs with SCC state adds a second graph algorithm without deleting an obligation. |
| Publication-derived identity | `captured-identity` plus its capture/publication callers: comparison can complete when two pending classes merge; fixed output partitions need not wait for all producer decisions. Direct source-version sharing still exposes later writes to older captures. An immutable producer rewrite must replace mutable gate authority too. |
| Native authority and historical metadata | `external-operation`, `external-metadata`, `external-mutation-tree`, native path/entry callers: removed reservation memberships and redundant metadata completion ownership. A single unpartitioned frontier would scan unrelated sibling effects on ancestor checks. |
| Array mapping and consumers | Every function in `array-methods`, `array-invocation`, `array-remap`, `array-view`, `array-length`, `language-conversion`: unified output publication and removed range carrier. Sort's second preparation wave consumes nested conversions discovered by element delivery; eager graph capture changes short-circuit searches. Persistent layouts remain a separate unproven replacement, not implemented behavior. |
| Queries and verification | `observations`, independent parent/storage/count oracles, generated histories, safeguard registry and source counters: source captures reused; one-table observers and anchors migrated. A `Promise.all` query coordinator cannot preserve `hasError` truth while unrelated branches remain pending. The [D04 follow-up](docs/audit-report.md#d04---query-completion-simplified-producer-redesign-remains-unproven) retains early query outcomes and replaces recursive completion waits with one operation-local counter, releasing spent stages. Existing loader consolidation remains in use. |

These findings justify the retained changes and reject the specific alternatives
listed. They do not prove architectural minimality. Further work should propose
and test a smaller invariant against these concrete flows; contract decisions
below remain distinct from current-semantic implementation improvements.

### Verification for the broader batch

Focused admission, Array, metadata, parent/retirement and publication tests pass,
including the prototype's initially failing structural histories. Final normal
and publication-traced suites each pass **6,189 tests**. The first traced run
hit Mocha's two-second timeout in the portable VM-loading test under concurrent
verification load; its isolated rerun passed. The complete traced rerun used the
same 30-second Mocha allowance as the safeguard runner, without changing test
assertions or the fixtures' own subprocess deadlines.

All nine enlarged checks passed with publication tracing and
`CASCADA_SEQUENCE_SEEDS=1600`: preparation/lifecycle, placement, Array, nested,
external, boundary, pending-boundary, receiving/invocation and Promise-key.
There were no failed or skipped generated cases. Reports include:

- Preparation/lifecycle: 14,528 programs and 43,584 harness runs.
- Placement: 6,400 cases.
- Array, nested and external: 9,600 programs and 28,800 runs each.
- Boundary: 51,200 active replays plus 128 retirement programs.
- Pending boundary: 12,800 passing tests.
- Receiving/invocation: 305,600 receiving and joint key/data histories.
- Promise keys: 9,602 programs and 28,806 runs.

The full traced conflict matrix passed **93,636 cases / 280,908 executions**,
covering all 2,601 command triples and all three harness modes. Both complete
suites also include the bounded publication-pair sample; no separate full
publication-pair product is claimed.

Changed admission, Array, placement/recovery and metadata safeguard faults all
produce their intended witnesses. All **279 source edits in 263 safeguard
entries** match current code. The final suites include the retained GC and work
controls, including the new metadata callback/diagnostic-stack cases. All 751
checked relative Markdown links resolve, and `git diff --check` passes.

Final logs are in `%TEMP%/cascada-wide-verification`. Earlier verification sections
are historical. No supported contract was changed, and the original dirty work
was preserved. Independent review found no further material concern in the
combined representation or completion paths; this is a completed structural
review, not a proof that every possible future architecture is minimal.

## Decisions for later review

### 1. Prioritize the existing status-only repair revision

The largest identified structural reduction is already specified in
[repair-simplification-plan.md](repair-simplification-plan.md), alongside
[the Chain modes plan](poison-policy-plan.md). It is not a new proposal or a
description of production behavior.

Today, failed managed mutations preserve a predecessor for repair. Recovery
storage consequently participates in placement capture, preservation parents,
COW, retirement, and publication. External repair also resets a covered subtree.
The planned model keeps current data plus an own-path failure status; repair
clears that status. This can remove repair-only predecessor storage and the
associated retention and restoration paths, and replace subtree resets with
exact-own status updates.

**Decision:** make this planned semantic cutover the next implementation task,
or retain today's rollback-style repair for now. It must land with the relevant
production contract and failure-policy updates. Removing recovery storage alone
would break supported repair. Native receiver isolation, immutable captures,
imported protection, and copies required by pending publication remain necessary.

### 2. Consider requiring external registration before first use

`ExternalAccess` retains external path identities and rechecks them after waits
when the execution's registration revision changes. `path-operation.js` carries
that obligation across managed snapshot paths. These checks implement the
documented late first-registration exception: a previously unregistered root,
intermediate identity, or receiver may become registered elsewhere while access
is suspended.

If host/compiler integration instead guarantees registration before a resource's
first use, the runtime can remove `authorityIdentities`, `authorityRevision`,
`_externalRegistrationRevision`, and the retained-prefix revalidation path.
Canonical authority, duplicate-registration validation, external reservations,
and capability-escape checks still remain.

**Decision:** is late registration after first use an application requirement?
If it is, keep the current revision-gated mechanism. If not, narrow the host
contract explicitly and remove this machinery without introducing another
enforcement registry. These are supported-behavior checks today, not misplaced
defenses against forged interfaces.

### 3. Establish which historical design material must remain active

The repository contains current contracts, selected future plans, superseded
alternatives, phase reports, and manual probes. That makes architectural status
harder to determine than the source alone. The README still described implemented
identity work as planned; that stale paragraph has been removed.

**Decision:** identify which historical reports/probes remain required review
evidence. Then archive superseded material behind a short history index, preserving
links from active contracts and tests. Keep the selected root plans visible and
clearly separate from current behavior. Do not delete executable witnesses or
promote planned behavior into the production contract during that cleanup.

The already selected [persistent Array layout](array-layout-approaches.md) is
another major architectural workstream. Its net simplification is unproven: it
also introduces streaming and failure-policy responsibilities. It should not be
sold as a line-count reduction until its implementation replaces the old paths
and meets the documented work bounds.

### 4. Canonical logical storage instead of managed physical writes (S7.3)

The current placement commit reconciles physical storage with authoritative
versions, including required writes, optional Promise-cache synchronization,
Array backing projections and stale-storage masking. Making all managed writes
logical-only could remove required-storage preflight/write branches and much
storage/overlay reconciliation; import and native assembly would become the
remaining physical boundaries.

That is a contract change. A supported managed Proxy can reject an element write
without changing its storage; today's requested mutation then fails and retains
its repair baseline. Eliminating that host write would make the same operation
succeed. Optional cache refusal already has the narrower, nonpoisoning behavior
and cannot justify changing required writes.

Alternatives are to retain required physical writes, explicitly make managed
storage an immutable import representation, or preserve a compatibility write
path. The last alternative keeps the complexity this proposal aims to remove.
Recommendation: defer this cutover until its observable storage/failure contract
is chosen explicitly, and evaluate it together with the Array layout and repair
revisions. No current-semantic deletion of required write behavior is authorized.

## Initial local-pass changes (historical)

- **Array length:** derive whether a history node is a question from its existing
  delivery callback; remove the redundant `question` flag and its duplicate
  callback check.
- **Array operations:** specialize the single-use generic sparse-remap helper
  directly in `reverse`; put search-bound normalization beside the branches that
  consume it, removing unreachable cases and two helpers.
- **Array construction:** remove duplicate backing-owner registration already
  performed by the backing constructor, plus an unused import.
- **Copied delivery:** store versions directly in the delivery membership set,
  removing the separate member record's backlink to its version.
- **Counter retirement:** let `refcounts.js` own projection cleanup and reuse its
  backing-membership release function. Parent retirement no longer knows the
  counter index's internal fields. Update the three affected fault-injection
  entries to follow the moved mechanism.
- **Snapshot capture:** use the existing snapshot-placement reader for full-graph
  property capture, removing a second pending-presence validation path.
- **Managed invocation:** select the invocation function once and share argument
  forwarding between observation and mutation.
- **README:** remove stale migration status and distinguish native Error data
  from recoverable poison.

Each retained edit removes duplicated state, a needless abstraction, or knowledge
at the wrong module boundary. No public API or architecture contract was changed.

## Requirements retained, implementations still open to review

- Complete incoming placements describe topology; counter parents describe an
  acyclic projection; preservation parents keep hidden repair baselines alive.
  Their facts must remain distinguishable; shared maintenance is still a search
  candidate, not ruled out by that distinction.
- External reservations order host effects. Metadata versions preserve historical
  poison queries and allow repair to overwrite pending outcomes. A replacement
  must express both obligations without unnecessary duplication or serialization.
- Observation and mutation traversal differ in COW, poison placement, rollback,
  and publication. This does not rule out a shared captured-location protocol
  with operation-specific effects; it rules out merely hiding the current walkers
  behind flags and callbacks.
- `includes` can finish on any proved match; ordered searches must establish the
  winning index. Different result reducers may still share capture and demand
  machinery.
- Physical Array backing, logical producers, and captured length questions differ
  when writeback fails or structural publication remains pending.
- Source-clearing assignments and distinct release/close points protect collection
  through pending callbacks and unformatted Error stacks. They are not cosmetic.
- Nested fatal guards prevent internal defects from entering language recovery.
  Execution binding and closed-entry checks protect supported isolation and
  authority. No substantial unsupported-misuse defense was found to remove.

Changing recovery-parent key sets into counts was considered and rejected: it
would exchange bookkeeping forms without a clearer invariant. Sharing metadata
ancestor capture between entry and ordinary operations was likewise rejected:
the small reduction would couple entry setup to operation ownership.

## Initial local-pass verification (historical)

Focused test batches cover the changed mechanisms, including publication
instrumentation, ownership and retention, Array behavior, snapshots, and
invocation failures. Final results:

- Full suite: **6,182 passing**; final full suite with publication tracing:
  **6,182 passing**.
- All nine required enlarged checks passed with `CASCADA_SEQUENCE_SEEDS=1600`
  and publication tracing: preparation/lifecycle, placement, Array, nested,
  external, boundary, pending-boundary, receiving/invocation, and Promise-key
  histories. No generated cases failed or were skipped.
- All three counter-retirement fault injections still detect removed cleanup.
  All 102 safeguard edits targeting changed modules match current source.
- `git diff --check` passed.

For subsequent review work, batch related simplifications before testing and
reserve the full validation pass for the completed batch. Assess each edit for
clarity as it is made; do not rerun tests for every small cleanup.
