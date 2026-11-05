# Array layout: implementation decisions and probes

This records the technical baseline for [Variant B](remap-structure-variant-B.md). The [mode/failure foundation](../poison-policy-plan.md) defines complete and streaming outcomes before the [push-only entry stage](../array-layout-approaches.md#integration-order) adds open contributions followed by later pushes. These probes implement neither extension. Shape bounds demonstrated here do not by themselves prove iterator publication: membership, final source selection, and the mode’s position requirements must also hold.

The [executable probes](../test/experiments/array-layout-technical-probes.mjs) support the decisions below. They are deliberately smaller than a production layout implementation; their limits are listed with the results.

## 1. Separate semantic facts from owned contents

Use three existing concepts at distinct scopes:

| State | Holds |
| --- | --- |
| Captured shape/control fact | Bounds, normalization context, shared-control identity, and causal failure; no payload-owning layout root merely to answer shape. |
| Selection use | The source regions needed by one live output range, value capture, or operation. |
| Logical placement | Its established destination key and property version, published through the existing property boundary. |

A deferred region's selection rules refer to captured facts. A live selection use owns the content captures needed to apply those rules. Do not put an unconditional whole-source capture on shared control state: that would defeat releasing narrower uses.

New content captures derive from an existing content-owning use. A shape-only handle cannot later acquire discarded contents. Closing or narrowing a use clears its ordinary JavaScript references as well as its ownership counts.

### Shape rules stay with the operation

Preserve the operation's semantic shape separately from incidental tree grouping:

- fill, copyWithin, and reversal reuse their captured shape.
- push/unshift add a known count; pop/shift clamp a one-position reduction at zero.
- splice retains its normalized deletion relationship and insertion count. Inserting k without deleting gives L+k even when the insertion boundary is unknown.
- slice retains its normalized selection; concat sums classified part shapes.
- indexed growth uses max(previous length, required length).

These are the method's transfer rules, not a general expression interpreter. Ordinary tree measures cache their projections. Splitting or balancing cannot replace a correlated region total with independently widened child intervals. Capacity consumes the [same required relationships](../iterate-plan.md#required-capacity-proofs).

### Compact ready count transforms

Ready additions and endpoint trims need not create a chain of shape nodes. Store one captured base and a normalized transform `clamp(base + offset, lower, upper)`:

- push/unshift changes the offset and shifted clamps;
- pop/shift subtracts from the offset and clamps the result at zero;
- a positive bounded prefix slice can add an upper clamp;
- shape-preserving methods reuse the fact; a length reset supplies a new exact fact.

Composing another ready shift/clamp updates these four fields. If the result is constant over the base's current domain, remove that dependency, even when the base has failed. Other root prerequisites and each command's identity/completion remain separate. The upper clamp represents a real operation such as slice; never clamp to the Array capacity limit to conceal overflow.

The probe checks 180,000 count outcomes and composes 20,000 append/trim operations while retaining one base reference. Pending splice controls and multi-part totals still use their method-specific region facts; this form is not a universal formula language.

### Shape captures have their own versions

A shape-only capture must reference count facts, not content-tree nodes. A content node being exclusively owned does not imply its count fact is exclusive: an earlier length query may still hold that fact. Later edits create or reuse the appropriate successor shape while preserving those captures. Settlement only refines the same captured fact.

Thus a loop capturing pending length before each push can retain small `base + offset` facts while the exclusive content tail continues to grow. It need not copy the content tree or create a linked length-history chain just to protect those queries.

### Shared controls stay shared

Preserve explicitly shared internal control facts and normalization context. Two fills whose mappings share the same captured boundary select under the same condition. For one destination, `C ? Y : (C ? X : original)` reduces to `C ? Y : original`; X cannot survive.

Apply such local composition when installing the mapping, without awaiting payloads or replaying the command. Separate command completion and identity may still need their own facts. Do not generalize this example into enumeration of all combinations of unrelated conditions.

The probes supply that shared control explicitly. They do not establish transport through the current run API: separate lookups produce different outward Promises, and a shared PoisonError is not proof of a shared computed input. The [captured-control boundary](../iterate-plan.md#captured-control-identity-at-the-api-boundary) requires no new provenance API solely to recover that sharing. Apply this reduction where shared facts already exist; compare resolved normalized arguments normally elsewhere. The probe is evidence for internal composition, not a requirement to identify separately wrapped arguments.

## 2. Use sliced ownership, not a producer-wide range registry

The first implementation should use existing persistent subtree sharing for determined source ranges. Each selection use owns its restricted root/spans; overlapping uses share internal nodes, whose use counts release contents at the last use. This avoids scanning every other consumer whenever one range closes.

For an unresolved selection, retain the source regions it can still select, plus the control and shape facts needed to refine that selection. Derive these regions backwards through the method's mapping. Narrowing a selection replaces its old uses only after acquiring the new ones.

This is a conservative content-retention calculation, not a substitute for precise output queries. It may retain unresolved candidate contents; it must release excluded independent regions. Existing physical-backing retention remains permitted. Sort and similar algorithms may genuinely need inputs outside the selected output range.

### Cursor and item captures have different uses

At determined boundaries, the cursor's unread-subtree frontier advances without copying a root per item. Issuing an item transfers its needed capture to that item; completion or early stop releases only the cursor's remaining uses. Length and last-item questions retain shape facts separately.

For `[R(width 0..1), Z]`, position 0 is guaranteed but selects R or Z. After a numeric lookup captures that selection:

- the issued slot retains both candidates until selection is determined;
- the unread suffix can contain only Z, so the cursor no longer needs R's contents;
- the cursor still needs R's width to decide whether another position exists.

Do not let the shared width fact retain R's payload. This is a lookup/lifetime example, not permission for sequential iteration to issue a structurally unresolved occurrence. That cursor waits for final source selection; future unordered discovery can capture Z separately.

## 3. Reuse parent-derived preservation for deferred inputs

The runtime already separates logical placement parents from preservation parents:

- [parent-placements.js](../src/parent-placements.js) exposes preservation parents to retirement without reporting them as language placements.
- [meta.js](../src/meta.js) makes preserved children require copy-on-write.
- [ownership.js](../src/ownership.js) retires unrooted cycles through the combined retention graph.

Generalize that preservation mechanism for layout-owned captured inputs. The live layout owner retains each required input through a preservation use; this creates neither a guessed numeric key nor an Error/Promise membership claim. Use ordinary external captures/leases for independently held results and unfinished operation work at their existing lifetimes.

Extract the capture-observation and release logic already used by `preserveRecovery`, rather than adding another pending-value subscription path. Its `observePlacementCapture` subscription follows property-version publication; a layout use supplies its own owner and selection identity. Activation, narrowing, and retirement attach or remove that use at the same boundary as its forward capture.

Do not implement layout-owned inputs as unconditional lease roots. A cycle `Array -> deferred input -> Array` would otherwise keep itself alive after the Array loses its external owner. Parent-derived preservation lets the existing retirement proof inspect the cycle and release its layout uses.

### Publication baseline

For the initial integration, publish established changed placements through existing property versions and parent updates. Retain the current simple Array backing projection where it already applies. Defer arbitrary multi-span/reversed backing projection until a measured workload justifies that additional mechanism.

When selection establishes a managed value's destination key, acquire its placement relationship and required counter contribution before releasing its provisional preservation use or invoking consumers. Repeated occurrences get distinct destination keys. Later writes and truncation detach obsolete destination authority; earlier captures keep their own uses.

Direct updates can cost O(M) for M affected managed placements, even when the layout edit costs O(log B). Enumerate affected maintained placements, not sparse holes or unrelated data, and measure that graph cost separately. This baseline does not promise logarithmic total mutation cost.

### Retirement and restoration

Store authoritative forward selection uses on the owner. Active reverse preservation links and publication destinations follow the owner's existing activation/retirement lifecycle. Retirement removes them and releases internal-node uses; re-entry restores from maintained forward state without host reinspection.

The probe exercises ready-child preservation, COW, and cycle retirement. Pending-child delivery, re-entry, aggregate Error/Promise membership, and placement publication remain integrated-runtime verification requirements. A possibly selected input must not enter an output Error counter solely because it is retained.

## 4. Propagate changed facts, not dirty notifications

Maintain the compact summaries needed for active progress during settlement. Recompute an affected summary from its children and stop that propagation when the projected fact is unchanged. Notify consumers when their relevant bounds or outcome can change, after the synchronous update wave completes.

Different questions consume different projections: count bounds, existence, selected placement, or failure certainty. A numeric interval alone does not cover failure or selection. Their required dependencies remain registered even when count is exact. Complete Error collection keeps its own frontier rather than copying growing Error sets into every ancestor.

Optional detailed mapping caches may still use targeted dirtiness and demand-driven refresh. Making such a cache dirty is not, by itself, a reason to wake every retained cursor or length query.

### Counterexample to dirty-root wakeups

Take N captured versions of an initially empty Array. Each version adds a pending possible write at index 0. Every length lies in `[0,1]`; the graph never needs more than one element. Resolve all writes as no effect in issuance order.

An early false contribution usually changes neither a later version's bounds nor its answer. Nevertheless, a scheme that marks every ancestor dirty and wakes every root question performs N(N+1)/2 wakeups. This is avoidable history work on a fixed small graph.

The probe stores these versions in a persistent balanced index and compares both protocols:

| Pending writes / captures | Dirty-root wakeups | Changed-summary wakeups | Dirty visits | Changed-summary visits |
| --- | --- | --- | --- | --- |
| 32 | 528 | 32 | 2,144 | 240 |
| 128 | 8,256 | 128 | 33,408 | 1,344 |
| 512 | 131,328 | 512 | 527,872 | 6,912 |

For this workload each summary makes at most one final transition. Each child change visits its dependent summaries, and unchanged parents stop propagation. With bounded fan-out, work is bounded by the constructed shared index and its changed summaries, rather than the number of captured roots times the number of settlements.

The [completed work specification](array-method-specification.md#12-work-and-release-bounds) separates exact readiness, bounds, membership, selected values, and collection frontiers. The old per-wave O(V log B) bound alone does not establish acceptable total history work; the stress assertions below constrain the implementation.

### Exact questions must not subscribe to every numeric refinement

Changed-summary propagation also needs the right projection. The expanded probe captures N prefix sums. Every narrowing bound changes the numeric interval, but an exact-length question cannot finish until its required inputs are ready. Eager numeric propagation still produces N(N+1)/2 root updates.

Use projected readiness for that question and keep optional bound caches separate. At N=512, eager propagation performs 131,328 root updates and 263,936 node visits; readiness projection performs 512 final notifications and 6,912 visits. Membership and selected-value questions retain their own projections; exact-sum readiness is not a substitute for early prefix proofs.

The mixed-history probe combines conditional overwrites, definite overwrites, and permutations on four slots under 32/128/512 retained versions and three settlement orders. Every known source row remains final. At N=512 it performs 19,348 visits and 13,980 final row changes over 4,608 shared nodes, identically across the tested schedules. This tests a fixed-width composable projection, not a license to materialize sparse Arrays per index.

### Selection history needs the same discipline

A balanced output sequence does not balance a chain of conditional overwrites inside one region. Use a composable selection summary where the operation permits it. The probe's last-write projection selects the rightmost nonempty contribution; an unresolved later contribution blocks selection, while a definite later write masks earlier ones.

This projection uses the same persistent index and change-sensitive propagation. It settles each captured result once under forward, reverse, and shuffled delivery. Shared-guard folding removes redundant alternatives before they enter this history.

Do not assume arbitrary remaps have this summary. Add a method family only after its deferred compositions have explicit progress, release, and work arguments. Forwarding chains must also compact and release spent references with synchronous worklists.

## 5. Probe coverage

Run:

```sh
node test/experiments/array-layout-technical-probes.mjs
```

| Probe | Evidence | Limit |
| --- | --- | --- |
| Partial splice, append, endpoint/reverse selection, insertion shape | 2,140 fact checks; successful layouts compared with native Arrays; rejected controls retain their domains. | Fixed start or insertion-only uncertain start, one uncertain region, unique source selectors; not a complete dependency evaluator. |
| Count fusion | 180,000 outcomes; 20,000 append/trim operations retain one base; prior shape captures stay unchanged. | Ready shift/clamp transforms, not arbitrary pending control expressions. |
| Shared guard | 20,000 successive writes retain one choice and the original fallback. | Identical guard folding; not arbitrary mixed-condition optimization. |
| Sliced ownership and cursor frontier | Overlapping uses release independently; 32 consumed leaves release while 32 unread leaves remain; uncertain slot and suffix use different candidates. Backward demand rules pass 4,042 comparisons against enumerated source sets. | Structural use counts and simple drop/join demand rules, not GC timing or a full nested deferred-range selector. |
| Fact propagation | Fixed-size counterexample above; failure without narrower bounds and later masking success are checked. | Small max-growth projection, not all shape/failure reductions. |
| Selection propagation | 196,608 comparisons against an independent sequential winner scan across three settlement orders. | Conditional fixed-slot writes; not arbitrary splice history. |
| Runtime preservation adapter | Real COW/retirement code protects an unplaced ready child, reports no guessed key, and retires two cycle cases with/without an independent hold. | Experiment-only use of the current preservation protocol; no production layout code added. |

## 6. Specification and integration acceptance

The [method specification](array-method-specification.md) completes the normalizer/correlation, unknown-length, coupled-copy, sorting/flattening, occurrence-role, and failure rules. The [iteration analysis](array-iteration-technical-analysis.md) selects holder delivery and the pending-step lifecycle. The earlier shape probe retains abstract failed domains; it is not an implementation of the selected fallbacks.

The expanded [method probe](../test/experiments/array-method-specification-probes.mjs) passes:

| Evidence | Coverage |
| --- | --- |
| Coupled copying | 63,264 selector queries and 44,328 sparse-placement checks against native copyWithin. |
| Coordinates | 238,383 normalization/length witnesses and a shared-control fallback counterexample. |
| Sorting | 1,386 permutation cases with fixed undefined/hole suffixes. |
| Flattening | 70 depth domains, including holes and repeated aliases. |
| Runtime integration | Four fulfillment/rejection and pre-delivery-detachment cases: indexed publication before callbacks, captured queries, alias/cycle export, retirement, and re-entry without resubscription. |
| History work | Exact-sum and fixed-width mixed-transform counter tests at 32/128/512 versions. |

The focused existing Chain, refcount, and boundary-lifetime suite also passes 129 tests. These checks validate the reused mechanisms and specification algorithms. They do not claim that the future production layout has already passed end-to-end tests.

At implementation, run the same witnesses through actual layouts and the repository's required sequence/conflict/consistency/lifetime suites. Preserve restricted captures, forward-state restoration, role-aware queries, and the measured work assertions. Balancing/leaf constants, optional cache thresholds, generalized projection, and materialization thresholds remain implementation measurements, not unresolved method semantics.

