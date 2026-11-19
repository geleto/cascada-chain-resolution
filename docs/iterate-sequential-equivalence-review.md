# Iteration plan: sequential-equivalence review

Review date: 2026-11-19. This is evidence and review history, not a separate normative specification or certification of the unimplemented partial-layout runtime. [iterate-plan.md](../iterate-plan.md#sequential-equivalence-is-the-publication-criterion) owns publication, iteration and rollout; [Chain modes](../poison-policy-plan.md) own failure policy; the [method specification](array-method-specification.md) owns evaluator rules. Tables below summarize those sources, which take precedence. Current production contracts change only at their implementation cutovers.

## Successful reference execution

Use the same issued operations, eventual successful inputs, captured aliases, and supported host outcomes. Make their inputs ready and execute logical effects in issuance order. Every completed observation and effect in any asynchronous schedule must match that execution, including intermediate reads. The controlled observation-copy API, sparse semantics, write-based identity, and supported comparison rules remain part of the reference.

For compiled loops, the [program-level reference](../iterate-plan.md#sequential-equivalence-is-the-publication-criterion) also compares which commands get issued. Supplying the oracle with the concurrent implementation's chosen commands would miss wrong branches, break/return effects or else selection.

Unordered discovery is a delivery optimization. It cannot change output order, the index of a surviving occurrence, the first/last matching index, a mutation's returned length, or cross-Chain effect order. Required dependencies may stay pending indefinitely; an implementation may not replace pending with Error, fallback, a hole, or successful exhaustion.

## Findings and resolutions

| Area | Finding | Resolution in the plan |
| --- | --- | --- |
| Pending survival and searches | A ready prefix is not the complete candidate set. Treating an undelivered candidate as missing or failed changes successful results. | Wait for relevant membership/selection/comparison facts. A definite eligible match can finish includes; a negative answer needs all possible candidates excluded. |
| Search reuse | An unordered iterator's delivered items alone do not supply negative-result completion, fromIndex eligibility, or directional first-match proof. | Share internal occurrence discovery and captured facts. Preserve search-specific completion, source mode, holes, identity, and range checks; do not create an elem Chain for every comparison. |
| Complete access and mutation publication | Prefix access through possible whole-Array poison would change ready/deferred results under strict blocking; checking only public lookup/iterate misses other routes. | One captured-version gate covers observation, methods, writes, iteration including empty completion, direct results and nested export/native preparation. Queries/recovery/references retain exceptions. No complete prefix allowance; failed mutation flags retained data and repair clears status. |
| Sort provenance | Repeated-source construction could skip a comparator that a literal with equal values required. | Remove that shortcut. Keep semantic cardinality-based comparison-free cases and ordinary stable sorting over captured source order. No readiness-selected comparison, retry, or permutation. |
| Physical storage | A backing Proxy could veto ready writes that deferred/materialized writes avoided. | Logical managed storage is canonical. Representation fallback uses captured state and never replays user work; required input inspection and external/native effects retain their boundaries. |
| Pipeline contributions | Ordinary per-body mutating entries can serialize independent condition evaluation; ordinary pushes cannot publish in body arrival order. | Reserve contributions by source occurrence, preserve within-body issuance order, and start only work proved independent of gated targets. Returned lengths and reads retain exact earlier-prefix dependencies. Land this before advertising concurrent conditional-output loops. |
| Open production | Unconditional whole-Array blocking cannot also expose a still-invalidatable producer prefix. | Complete waits for required output validity. Only the streaming modes use certified poisoned-prefix access. Validate individual appends in every mode and preserve earlier commits; private producer work never waits on its own output. |
| Unordered terminal failure | Skipping structural failures could otherwise end as a successful shorter enumeration. | Deliver independent survivors, then reject the terminal step with remaining structural poison. Ordinary whole-path blockers stop delivery; the explicit streaming prefix-poison state retains certified prefix delivery even after overflow. Ordinary payloads keep their own delivery. |
| Mode selection | A later consumer must not change the failure contract of an earlier producer. | Fix mode per channel at construction, with out-of-order stream as the selected default; inherit through entries. An internally unordered search does not change mode. |
| Ownership before numeric placement | Old text claimed a deleted preservation-parent mechanism had validated future layout ownership. | Generalize maintained source/backing occurrence relationships; separate retention from membership. Require COW, aliases, pending delivery, retirement and cycle witnesses before integration. |

## Required witnesses

| Issued program or state | Successful result and dependency |
| --- | --- |
| [A,B,C,D]; splice(2,p,X); includes(D) | For p=0/1 return true; p=2 returns false. While both outcomes remain possible, wait. No Error placeholder is created. |
| The same pending splice; includes(X) and includes(Z), with Z absent | X proves true in streaming modes after required root/capacity checks. Z waits: successful counts give false but a relevant rejected count creates structural Error. The native successful-completion probe alone does not justify publishing false. |
| [pendingA,B]; includes(B) | B can prove true without resolving pendingA. This does not make indexOf(B)=1 safe if pendingA could equal B. |
| [A,B] with pending search start | Filter each candidate by its captured range; negative starts retain captured-end dependencies. A known mismatch may remove a range dependency, but a matching candidate cannot ignore it. |
| Sparse [hole,undefined] | includes(undefined) and indexOf(undefined) differ in hole handling. Densification must occur only for the specified methods. |
| splice(2,p,X); push(Z); at(-1); reverse() | Z is last before reverse and first afterward when root/capacity prerequisites hold. Its intermediate numeric index can remain pending. |
| copyWithin with overlapping ranges | Read captured predecessor sources, never already-written destinations. Preserve holes and prescribed writes even for equal values. |
| Complete: pending-count splice; read unchanged index 0, includes(A), indexed write/delete, iterate, export/native preparation | Wait while count failure could whole-poison the Array. Actual failure exposes no prefix; success/irrelevance permits normal access. Include direct results, nested Arrays and empty-iteration completion. |
| Complete: queries, repair, whole-value replacement and reference capture | Do not require a healthy selected Array, but preserve required ordering/ancestor dependencies and carry unfinished gates through references. |
| Complete: private producer commands and outside consumer | Internal commands use preceding versions; outside access waits for required production validity. No producer/consumer self-wait, prefix allowance or whole-producer rollback. |
| Read/capture; pending mutation; read; later overwrite | Each read uses its issued version. The later overwrite cannot change old captures, and late settlement cannot overwrite the new data. |
| Same Promise in two argument positions | No provenance correlation is required while pending. Once successful values arrive, use those actual normalized values; independent abstraction must not invent a successful mismatch or poison. |
| Body 2 ready before bodies 0/1, all append output | Reserve logical contributions 0/1/2. Independent computation can run; final concatenation and conflicting effects retain that order. A push result includes exactly its earlier prefix, not later ready bodies. |
| Bounded bodies with an undiscovered earlier predecessor | Later parked bodies cannot consume the only admission slot needed by that predecessor. Completion credit and range containment affect pacing, never logical order. |
| Iterator self-modifies source or closes early | Already captured unread occurrences retain their old values. Closing future enumeration does not cancel an already-issued next step or required mutation effects. |
| Flat with unknown depth and possible Infinity cycle | A known leaf does not prove result-root validity. Retain depth/capacity/ancestry dependencies; no premature root or fabricated failure for a legal pending depth. |

The executable [review probe](../test/experiments/iterate-sequential-equivalence-probes.mjs) compares public runtime operations against native successful mappings with Cascada's return convention, across ready, synchronously delivered and deferred inputs. It checks intermediate snapshots and the pending deletion-count search witness. The existing method/iteration experiments supply separate finite selector arithmetic witnesses. Neither is an implementation of the future iterator or proof of its publication, contribution, or lifetime integration.

Validation during this review: 2,212 public-runtime executions across all 22 controlled method names, 8,848 intermediate/final snapshot checks, the three deletion-count membership cases, 900 native prefix-edit mapping checks, and 210 focused search, sort, transition-capture and status-repair tests passed. Prefix witnesses check footprint arithmetic, including copyWithin's destination extent and delete's hole semantics; they do not exercise a production prefix-poison state, which does not exist yet.

At integration, compare every early published fact against an independent small-state all-ready oracle, not only final export. Enumerate relevant ready/deferred delivery orders and include sparse presence, duplicate identities, callbacks, mutation results, overlapping paths, repaired successors and independent held snapshots. Test required progress without timeouts, and test work/lifetime bounds separately from value equality. No general combinatorial solver is required in production.

## Searches after actual failure

Pending success is settled: wait while survival can still resolve either way. A permanently rejected deletion-count Promise is a different state; it will never later reveal a successful count. The selected streaming fallback then contains permanent structural Error slots and has discarded the candidate C/D payloads.

The earlier suggestion to report Error merely because membership is pending was incorrect and is excluded by the contract above. In a streaming prefix-poison state, a definite eligible prefix match can succeed. Complete-mode includes must first pass its Array access gate and cannot short-circuit through whole-Array poison. A result that still requires the actually poisoned remainder encounters its cause, not a speculative Error placeholder. Waiting for another still-pending relevance proof is valid; waiting for an already-rejected Promise to recover is not. Regional structural Error slots in otherwise accessible streaming layouts must use their defined selection-failure role, rather than silently becoming healthy negative evidence by comparing a placeholder. Ordinary payload Error comparison keeps its separate existing semantics. No failure-only rule weakens the successful/pending guarantee.

## Integration status

The production partial-layout evaluator, iterator, contribution protocol, and generalized source-occurrence ownership are not implemented by this review. The known broad-scope failure propagation regression belongs to the existing runtime and must be fixed at its own transition boundary; it is not authorization to narrow the selected complete-mode scope. Pending-payload endpoint work and deep history release also remain integration acceptance work. Do not claim these properties from finite arithmetic probes or from the current runtime tests alone.

## Complete-mode access review

The selected contract is strict: no ordinary consumer exposes retained Array data while logically earlier work could still whole-poison that captured version. This includes unchanged prefix reads, methods, indexed writes/deletion, iterator steps and empty completion, direct method results, export and nested native preparation. The [complete access gate](../poison-policy-plan.md#complete-access-gate) owns the route inventory and query/recovery/reference exceptions.

Certify the captured predecessor, not a live flag and not every payload. Ordinary [pendingA,B] can issue element holders and expose B because payload rejection does not whole-poison the Array. An earlier pending structural operation can create a genuine whole-Array dependency even for B. Later mutations belong to successors. Private entry work must not wait on the enclosing output it is producing; an outside consumer of that output does wait while required validity is unresolved.

Complete retains current data under blocking status after failed mutation. Earlier successful producer appends stay committed internally, but their existence does not justify consuming the still-invalidatable post-producer Array. Repair exposes retained current data; complete is not a transaction rolling back the whole producer. A streaming prefix allowance received by a complete Chain does not bypass its gate.

These strict-gate witnesses remain integration requirements; the prior runtime/layout probes above do not implement or certify this new access policy.

## Streaming producer failure and usable prefix

For the two streaming modes, the selected state is a poisoned Array with a usable prefix; iteration and observations/mutations within it work, removing positions shrinks it, unshift works, push does not, and isError stays true. Iteration never consumes the remainder. Cascada's existing loop-poison behavior marks all variables mutated by the loop, including when failure arrives late. [The mode contract](../poison-policy-plan.md#poisoned-array-with-a-usable-prefix) owns these rules. Boundary derivation and integration remain implementation work; the selected overflow behavior preserves explicit prefix access.

This state belongs to streaming mode semantics; it is no longer an exception to complete-mode blocking. Distinguish an atomic mutation from a producer containing many mutations. A possible internal representation is a captured prefix plus failed producer continuation:

```text
committed contribution: [A, B] + failed continuation(cause)
```

The failure needs no Array slot, including at capacity. A captured numeric prefix boundary is sufficient for prefix-compatible operations if ordinary layout publication maintains it; it must not be a mutable threshold attached to raw backing or shared across historical versions. A producer contribution can supply that boundary without inventing missing values. Store the cause once on the appropriate captured Array/layout state. Ordinary graph capture and copying must preserve this state without a new raw-result transport. A prefix is usable only when membership, order, source selection and authority are established and no permitted remaining mutation can invalidate it.

For a single poisoned remainder after [A,B] in either streaming mode, the selected behavior and its dependency consequences are:

| Consumer | Outcome |
| --- | --- |
| Read index 0/1 or slice(0,2) | Retained A/B, because the requested region is established. |
| includes(A) | True from the definite match; no complete-tail dependency. |
| includes(Z), with no other sufficient proof | Wait while the tail is pending; after terminal relevant failure, report its cause rather than fabricate absence. |
| Total length or end-relative access | Use actual captured shape facts; never substitute usable prefix length for total length. If the result still needs the unavailable remainder/end, report its cause. |
| Full export or successful end-of-iteration | Do not silently return the prefix as a complete healthy Array. Preserve/report its poison. |
| Ordered iteration | Deliver the committed prefix, then fail at the continuation. This is the same with ready failure and delayed failure. |
| Any iterator of the prefix-poison state | Stay within the certified prefix, including on repeated iterations. Ordinary regional streaming failure remains a separate state with its existing survivor rules. |
| Prefix edits | Maintain the prefix boundary and preserve Array poison. Removing positions and property deletion remain distinct; unshift is allowed subject to ordinary capacity, while push is blocked. |
| Explicit recovery | Keep status-only semantics over retained current data. Never invent missing data, discard independent pending production, reconstruct candidates, or resume an old iterator. Remaining data Errors remain Errors. |

This permits access through explicitly certified Array poison only in streaming modes. Complete uses the blocking gate described above. An arbitrary pending mutation, sort, unknown path that could select length, or unrestricted entry can affect the prefix and supplies no such guarantee. Do not expose partial changes from a complete-mode splice, or infer an allowance from the hidden data of an ordinary poisoned ancestor. Controlled consumers need one common prefix-aware selection boundary; per-method ad hoc bypasses would lose the invariant.

The difficult cases must be resolved together:

- **Remapping:** confined splice/shift/unshift update p by their removed/inserted counts. A whole reverse or sort is not silently reinterpreted as a prefix operation; if it consumes the unavailable remainder, it fails before candidate changes publish. Bounded extraction can exclude that remainder. This restriction avoids needing arbitrary movable failure regions merely to support the prefix state.
- **Independent producers:** do not infer a prefix allowance from later ready islands. The prefix state restricts every iterator to [0,p); an otherwise usable streaming Array with local failures retains its separate independent-survivor policy. Root failure and regional failure must not be interchanged by representation or timing.
- **Already-issued work:** one issuer's failure does not cancel nested or sibling work already issued. Close only the failed continuation; preserve their reservations, ordering and completion. Callback rejection alone is not proof that every relevant issuer has closed.
- **Loop poison delivery:** terminal-only reporting can be missed by a consumer that stops pulling. The Cascada adapter must connect captured Array poison to the existing loop-failure mechanism independently of terminal polling and at the logical position of that loop. Verify [mode-specific validity and completion](../iterate-plan.md#mode-specific-validity-and-completion) against existing loop work, including any separately required failure dependency after cursor closure. Complete-mode validity tracking adds no pre-access gate to either stream. Do not scan payloads, manufacture duplicate causes, keep a closed cursor's source solely for reporting, or redesign break lowering.
- **Recovery:** an indexed overwrite cannot implicitly certify the entire missing remainder. Ordinary prefix edits keep the flag. Status-only repair exposes retained current data and does not conjure a healthy missing tail; explicit bounded extraction supplies a complete new Array where proved safe. Earlier captures retain their failure, and unrelated open producers remain open. Do not recursively clear element payload poison.
- **Capacity and fail-fast timing:** failure needs no extra slot at MAX. The selected streaming rule preserves requested prefix iteration even when poison is already known. Setting/querying isError remains immediate and requires no prefix traversal; a caller that wants to avoid processing a huge prefix can check it or close enumeration early. Automatically refusing prefix iteration on overflow would contradict that availability rule and can make delivery count depend on failure timing. No such automatic exception is selected. Terminal failure avoids waiting forever for more tail data; already-issued effects are not cancelled.
- **No accidental failure loss:** materialization, export, queries, iteration, copying and explicit truncation must agree on whether the failed continuation is included. A plain native Array cannot encode it, so full export reports Error; a bounded extraction proved to exclude it may succeed.

This streaming state is selected. Its common selection boundary, captured prefix maintenance, queries, mutation results, receiving/export and terminal loop-poison publication must land together. Complete remains strict. For streaming modes, prefix availability takes precedence over the earlier preference for automatically stopping on overflow: Error inspection is immediate, but explicitly consuming a huge usable prefix still costs its size. Successful sequential equivalence remains mandatory. Position removal shrinks the prefix; JavaScript property delete keeps its existing hole semantics unless separately revised.

## Review after the strict-complete split

This pass checked mode boundaries, all consumption routes, method reductions, cursor termination, bounded admission, captured-state handoff, source failure lifetime, tree/graph ownership, work bounds and rollout dependencies. The persistent layout and shared evaluator remain the selected architecture; neither is certified by specification probes alone.

| Finding | Resolution |
| --- | --- |
| The cursor still granted poisoned-prefix access to every mode. | Restrict it to the two streams. Complete fails its access gate before any item. |
| Numeric end and generic done wording could hide poison or reinterpret explicit closure as healthy empty input. | Natural exhaustion checks retained structural failure, including p=0 and p equal to retained length. Return/post-close done only acknowledges local closure; it does not authorize loop-else. |
| Window credits covered body completion but not skipped structural positions. With B=1, [structuralError,B] could strand B forever. | Use one finalization transition for body completion and proved structural skipping. Preserve failure and didIterate separately. Communicate skip proofs during a pending pull and close their no-body ordering reservations. Batch failed runs, require integer B, and keep effective source-end clipping separate from stored demand. |
| Payload identity alone does not prove interchangeable placements. | Preserve presence, own status, structural role and prescribed writes during reductions/coalescing. Flagged versus healthy holes and structural versus ordinary Error data are explicit witnesses. |
| Value lifetime protection was being treated as evidence of complete semantic handoff. | Add a prerequisite prototype for pending own status, Array validity, prefix allowance, role transfer and isolated repair. The current delivery ledger protects values; complete placement transfer must carry the promised metadata. |
| Phase 9 still requested logical-Chain diagnostic grouping despite the selected existing-context policy. | Retain current causal Errors and reference deduplication, without new Chain identities or propagation history. |
| Root poison associated with a loop independently of terminal polling can outlive early cursor closure. | Apply [mode-specific validity and completion](../iterate-plan.md#mode-specific-validity-and-completion): complete establishes source validity before any successful step; the two streams retain existing prefix and loop-failure behavior. Verify the integration without treating cursor return as loop-publication completion. |

An independent small-state window oracle selects the earliest B non-finalized positions and compares them with the demand interval. This review checked 7,100 finalized-state combinations and 52,248 body-completion/structural-skip transitions. The old body-only credit rule fails the B=1 witness; the generalized rule preserves the bound. This is arithmetic evidence, not implementation or scheduler validation.

The new state-handoff and deferred-source ownership bridges remain implementation prerequisites. In particular, do not infer from existing pending-payload or lookup probes that placement-owned status survives an arbitrary raw-value round trip, or that new layout-held cycles already retire correctly. These need the public-runtime witnesses specified in the plan before partial-state publication.

## Complete-only validity clarification

The accepted clarification applies to complete mode only. Track required Array/ancestor failure through captured transition/placement state and relevant open/nested issuers, as specified by [the validity rule](../poison-policy-plan.md#tracking-complete-mode-validity). Neither healthy arguments nor zero currently pending commands prove an open output safe. Invalid values, required comparison/publication and producer control-flow failure can still matter; ordinary stored-payload rejection and independent result failure do not themselves whole-poison their source.

Complete consumption can proceed once remaining relevant failure is excluded, without waiting for unrelated payloads or all layout facts. Its first successful step therefore cannot precede a later whole-Array failure of the same captured source. Subsequent mutations belong to successor versions. Queries, repair, internal references and private producer commands preserve their existing exceptions and predecessor views.

Both streaming modes retain the selected usable-prefix state and Cascada's existing failure targets and control-channel lowering. The later scope clarification resolves break and function return through those ordinary mechanisms; no separate post-close source-status bridge or mandatory whole-producer wait is selected. No new runtime implementation is claimed by this documentation update.

## Claude Code and Astra review reconciliation

Both supplied reviews predate the complete-only validity clarification. Their current findings were compared against the plans and local runtime sources, including Cascada's loop dispatch, poison publication and future stream documentation. No production runtime was changed in this reconciliation.

| Review finding | Assessment and resulting plan change |
| --- | --- |
| Claude 1: the basic complete gate already exists | Agreed. The plan now identifies transition-version gating as the baseline to preserve and extend. It does not request per-consumer health machinery. Partial-layout/producer integration and the known broad-scope regression are still new work. Complete can use partial facts after validity is proved, so the entire shared layout engine is not inherently streaming-only. |
| Claude 2: replace modes with guard and append-only streaming | Not adopted. Guard restores a region, while complete repair exposes current retained data without undoing earlier successful commands. The proposal also removes expressly selected structural publication/fallback behavior. Current test-call frequency does not establish that those requested workloads are unnecessary. Subsequent clarification selects the mode per channel through a constructor argument, defaulting to out-of-order stream. |
| Claude 3: remove poisoned-prefix state | Not adopted. Marker, genuine own failure and consumer-loop propagation have different owners. Their distinction and the no-retraction proof are now explicit in the mode contract. An ordinary missing contribution preserves later contributions; a possible genuine earlier prefix blocker retains the relevant publication dependency. Reserving the last slot changes legal capacity, and absorbing later contributions loses issued work. Neither simplification is authorized. |
| Claude 3: current loop poison cannot preserve Array data | Agreed as an integration gap. Current base-chain poison replaces its target; existing compiler target discovery/order can be reused, but kernel status/marker publication needs adaptation. The later scope-based return clarification resolves the completion contract; preserve ordinary loop/scope ownership instead of adding a new return policy. |
| Claude 4: contribution bounds | Agreed with qualification. Optional proved bounds belong in shared captured shape, include failure output and count values rather than push sites. They aid capacity, index ranges and admission. Unbounded contributions remain supported with necessary waits; no arbitrary application limit or whole-program proof is imposed. Required bounded capacity reductions are retained. |
| Claude 5: order by contribution path | Reuse proved relative output order without waiting for a numeric index. Do not replace the selected window/public index contract: an emission path need not remain output order after general Array remapping, and an unknown earlier contribution still occupies admission capacity. The proposed indexedPath API is documented as future work in Cascada, not an existing dependency to reuse. |
| Claude 6: duplicated authority and stale wording | Corrected Variant A and complete-failure summaries, qualified clean absence, and made this review evidence-only. Production docs/run.md remains a migration target rather than prematurely documenting unimplemented behavior. The existing normative sort home remains iterate-plan section 13. |
| Astra 1: negative search failure frontier | Fixed the success-only wording; includes(X) versus includes(Z) is now a paired acceptance case. Structural Error outcomes cannot become mismatch evidence. |
| Astra 2: copyWithin write predicate | Separated source selection from normalized non-self and sparse/status effect predicates. The length-two/length-three witness also checks identity with equal payloads. The arithmetic probe is explicitly a selector probe. |
| Astra 3: source selection before dispatch | Added one ordered admitted-category/authority capture shared by adapters, covering ArrayViews, external Arrays, replacement and fallible selection. |
| Astra 4: broader-scope baseline | Made the existing propagation regression an explicit integration blocker with an independently asserted sibling-read outcome. Matching schedules alone does not prove the contract. |
| Astra 5: flagged holes | Added distinct presence/status/effect projections and the flagged-hole reversal/clearing witnesses; the existing effective-presence helper needs a consumer audit. |
| Astra 6: bounded stage-6 fallback | Removed the sequential-cursor substitution. Bounded unordered loops with inter-iteration dependencies wait for stage 7; all enabled unordered routes keep survivor delivery and terminal failure. |
| Astra: reference, shared facts and milestones | Added the source-program oracle, duplicate-occurrence witness and first end-to-end public splice milestone, followed by the bounded-contribution pipeline witness. |

The [mode-specific completion contract](../iterate-plan.md#mode-specific-validity-and-completion) incorporates the resolved scope-based break/return behavior. Mode selection is also resolved as described below. Prior numerical/probe counts above are historical evidence, not new validation of these unimplemented partial-state contracts.

Reconciliation validation reran the method-specification and sequential-equivalence experiment scripts successfully after correcting their selector-only/success-only descriptions. This preserves evidence for existing runtime captures and the bounded arithmetic; it does not validate the proposed partial-state evaluator, compiled dispatch or loop-failure integration.

A separate public-operation reproduction confirmed the broader-scope defect: deferred splice-count rejection under an explicit root mutation scope poisoned the direct result and a[0], but the subsequent tag read still returned original. The execution did not fail fatally. This is a failing semantic baseline recorded for implementation, not a runtime fix in this plan update.

## Channel mode, break and return clarification

The user selected a per-channel constructor mode with out-of-order streaming as the default. This supersedes the earlier recommended complete default and closes the language-selection question; API spelling and compiler plumbing remain implementation work.

The user's break channel starts false and becomes true at the ordered break point, suppressing later body processing. Function return uses the same channel/conditional mechanism at every affected scope: a return inside a loop guards later body code and following code in its enclosing scopes. Neither channel write means cursor closure or completion of already-issued work. The earlier review incorrectly treated a current sequential-return shortcut as an unresolved language contract. That shortcut must preserve the user's specified ordinary control and scope dependencies; checking it is implementation work, not a new user decision. These observations do not certify the future managed-Array integration.

The [streaming failure inventory](../poison-policy-plan.md#whole-array-failure-in-streaming-modes) distinguishes unresolved regions, source-selection failure, the selected sort exception, opaque native scope, and controlled-method root failures still under review. The [capacity revision](../iterate-plan.md#streaming-capacity-revision) uses logical Error positions beyond the ordinary Array limit, including loss of values remapped there. Under the user's stated tolerance for this extreme failed state, its fallback length saturates at Number.MAX_SAFE_INTEGER and later operations use that exact fallback; no lasting positional-indeterminacy state is added. Potential saturation must never add a global readiness check or delay otherwise independent work. The older streaming overflow policy is superseded in the planning contracts; implementation and the remaining non-capacity whole-result fallback choices still need work.

## Astra loop, handoff and capacity review

The subsequent Astra review supports the shared captured-layout design but identifies additional cutover requirements. These were checked against the current plans and both repositories; this reconciliation changes documentation, not either runtime.

| Finding | Assessment and normative home |
| --- | --- |
| Destructuring before the return guard and variable-length binding arguments | Confirmed by independent reproduction: the valid first tuple returns first, a suppressed second value 7 instead poisons the result, and a short tuple binds the index into b and shifts loop.index to 2. The [enabled-body rule](../iterate-plan.md#destructuring-in-an-enabled-body) moves validation into ordinary ordered control flow and fixes binding arity. |
| Lookup cannot implement inert item transfer unchanged | Confirmed: pending lookup returned the external identity before registration but ExternalLocationConflict after it; managed result reception retained the identity in both schedules. This demonstrates a transport/authority mismatch, not a new claim that raw lookup's existing registration policy is wrong. [Item transfer](../iterate-plan.md#item-boundaries) is inert, with checks at actual use. |
| Unordered next has an observable scheduling order | Agreed. The [trusted interface boundary](../iterate-plan.md#unordered-pulls-are-a-scheduling-interface) separates physical handoff from application-visible first-item selection, return and effects. |
| Temporary modes can change expression semantics | Agreed. [Temporary inheritance](../poison-policy-plan.md#expression-temporaries) makes compiler insertion/elision transparent without changing explicit receiving-channel policy. |
| Complete mode can inherit oversized data | Agreed. [Cross-mode capacity](../iterate-plan.md#complete-mode-receiving-an-oversized-value) separates existing access, true no-op mutation and newly produced Arrays. Receiver and removed-result counts are distinct. One result/mutation interaction remains an explicit user decision. |
| Lossy tails invalidate inverse-edit rewrites | Agreed. [Per-operation loss](../iterate-plan.md#preserve-loss-at-each-operation) now explicitly constrains composition and both storage variants; an orientation flip implements only the mapping. |
| Tail causes and saturation need stable ownership | Agreed. [Causal spans](../iterate-plan.md#tail-causes-and-result-failure) preserve old causes, attribute new loss locally, and report an unrepresentable final append through its direct result without rewriting old data. |
| Virtual keys and full consumers need precise boundaries | Agreed. [Virtual-position and collection rules](../iterate-plan.md#virtual-positions-and-full-consumers) preserve ordinary key-creation restrictions and complete prefix/tail Error collection without impossible native assembly or per-slot traversal. |

The loop and registration reproductions are current-runtime evidence. Small-limit overflow examples describe the proposed semantics, not implemented capacity support. This update does not claim to rerun or independently validate Astra's full-suite or window-state counts. Existing layout/ordered-cursor development can proceed, but compiled-loop and capacity cutovers require the corresponding acceptance cases. The remaining new contract choice is [complete-mode splice with a valid receiver successor and an oversized removed result](../iterate-plan.md#decision-oversized-removed-result-in-complete-mode); the recommended result-local failure and the atomic-call alternative are recorded there without silently selecting one.
