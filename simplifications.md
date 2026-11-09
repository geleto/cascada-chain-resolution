# Simplification review

**Status, 2026-11-09: no simplification awaits a user decision.** This file records
implemented changes, rejected or reverted alternatives, and possible future
investigations. Separate future plans are not unfinished audit decisions.

Retained design comparisons from 2026-11-05/06. The
[audit report](docs/audit-report.md) owns current decision status, coverage and
verification; [data limitations](docs/data-limitations.md) owns runtime contracts.
These evaluated alternatives do not establish architectural minimality. The
[search tree](docs/coverage-tree.md#simplification-search-tree) tracks further work.

## Structural review — 2026-11-05

This follow-up preserved the existing local simplifications. C01–C15 are current
responsibilities; F01–F05 remain future work.
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
it while publishing own failure status (now using D01 placement metadata). Blocked native operations remain result-only and
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
| S1.2: logical producers | Use the source version directly for every copied/backing destination. | Backing producers already use ordinary placement-version publication; their extra object projects physical indexes through live owner ranges. Copied delivery captures one completion independently of later source-version writes. Direct sharing would expose later value, presence or own failure status to earlier copies. An immutable-version redesign must replace gate and mutation-version authority together; no complete protocol deletion was established here. |
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

### Structural verification

Historical final normal/traced suites each passed **6,187 tests**. All nine
generated families at 1,600 seeds and the full traced conflict matrix passed;
the full publication-pair product was not run in this pass. Fourteen affected
safeguards had semantic witnesses; five GC cases cover the corrected snapshot
prototype retention. These are outcomes for that batch, not fresh current-source
acceptance. Later verification is consolidated in the audit report.

## Implementation-wide review — 2026-11-06

This pass followed issuance, admission, selection,
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
share `activatePlacement`, including copied delivery. Optional counters and
incoming occurrences answer different bounded queries; neither duplicates the
forward version table. D01 subsequently removed hidden recovery parents and uses
ordinary relationships for data retained under failure status. The pending-append
fixture counts the one maintained store once and independently counts parent links, owner visits,
subscriptions and captured memberships.

The prototype exposed an implicit-presence gate update; existing structural and
Array histories detected it. Version creation and updates now canonicalize
presence to a Boolean. Copied-delivery activation can synchronously publish a
completed delivery; independent parent/storage checks cover that transition. Parent/storage verification still reconstructs expected data from
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
and test a smaller invariant against these concrete flows. The resolved follow-up
decisions below are separate from these implementation improvements.

### Verification for the broader batch

Historical normal/traced suites each passed **6,189 tests**, along with all nine
1,600-seed generated families and the full traced conflict matrix. The publication
matrix ran only its bounded suite sample. The first traced run hit a two-second
VM-loading timeout; the complete rerun used the safeguard runner's 30-second
allowance without changing assertions or child deadlines. Changed safeguards
produced their intended witnesses. These results precede the whole-project audit;
its report and manifests contain the later complete verification.

## Resolved follow-up decisions

The [audit report](docs/audit-report.md) is the single decision record:

- [D01](docs/audit-report.md#d01---exact-path-status-repair-implemented): exact-own
  status repair is implemented. The [repair plan](repair-simplification-plan.md)
  retains the future streaming and positional policies.
- [D02](docs/audit-report.md#d02---context-import-already-registers-the-compilers-external-resource-tree):
  context import already registers external resources. Retain checks for access
  that began before context initialization.
- [D03](docs/audit-report.md#d03---imported-managed-originals-are-protected-owned-storage-remains-writable):
  imported originals are protected; retain physical writes to runtime-owned storage.
- [D04](docs/audit-report.md#d04---query-completion-simplified-producer-redesign-remains-unproven):
  query completion remains simplified. Two producer experiments were reverted:
  one kept the same bookkeeping with extra callbacks; the other violated pending
  history bounds. There is no pending implementation task for these candidates.

The selected [persistent Array layout](array-layout-approaches.md) remains future
work with its own streaming and failure-policy obligations. Its net simplification
must be demonstrated by replacing the existing paths and meeting their work bounds.

Source-clearing, separate last-use points, counter projections, effect reservations,
historical metadata, and distinct search-completion rules retain their documented
duties. New proposals must simplify the mechanisms that meet those duties;
shared syntax alone does not establish a simpler design.
