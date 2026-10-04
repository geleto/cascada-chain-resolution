# Tests

`npm test` runs every `test/**/*.test.js` file with Mocha and strict unhandled rejections. To run one file:

```sh
node --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js test/verify-storage.test.js
```

## Kinds of tests

Prefer integration tests through public operations, as [AGENTS.md](../AGENTS.md#verification) describes. The suite adds several tools for evidence that single examples cannot provide:

| Tool | Use it for |
| --- | --- |
| [native-equivalence-support.js](native-equivalence-support.js) | Behavior meant to match native JavaScript, such as property, Array, and String semantics. |
| [fixtures/placement-sequences.js](fixtures/placement-sequences.js) | Seeded programs on one placement, checked against a sequential model with rollback. |
| [fixtures/preparation-sequences.js](fixtures/preparation-sequences.js) | Shared identities received by imports, initialization, assignment, and method results. A fixed 128-case product covers boundary × fresh/already prepared × ready/synchronous/native/ordered × record/Array × direct/nested, in all three harness modes. Seeded programs vary aliases and payloads; lifecycle programs model cyclic root removal, holder release, cached re-entry, and export generations with an independent forward-root liveness oracle. |
| [graph-oracle.js](graph-oracle.js) | Compares detached managed graphs with independent models, checking values, aliases, distinct generations, cycles, Array holes/length, record key order and prototypes. Two identity maps reject both split aliases and merged nodes. Functions and supplied Errors remain exact leaves; exact external identities and Error attribution use their boundary-specific checks. Self-tests demonstrate representative wrong graphs are rejected. |
| [fixtures/boundary-histories.js](fixtures/boundary-histories.js) | Cached reception through import, assignment, method results and host calls, followed by mutation, capture, source release, identity searches, export, managed calls, batch native arguments and ordered effects. Replays ready/synchronous/native/ordered schedules against independent graph expectations. The default 512 active histories and 128 fixed retired-root histories each cover 128 joint boundary/delivery/release/route/shape keys. A forward live-set check proves retirement before re-entry; pending cached-root identity failures remain separate strict witnesses. |
| [fixtures/array-sequences.js](fixtures/array-sequences.js) | Seeded Array programs on one owner or two independently mutated owners initially sharing backing: element entries, direct commands, failure and repair, length, structural methods, and observations issued directly, inside read-only entries, or on lookup snapshots. Either owner can mutate while the other has pending work. |
| [fixtures/nested-sequences.js](fixtures/nested-sequences.js) | Seeded programs on a nested record and Array graph: assignment, deletion, replacement, structure, lookups, and entries at any ancestor, checked against native JavaScript including record key order, on plain, imported, and view-sharing containers. |
| [fixtures/external-sequences.js](fixtures/external-sequences.js) | Seeded programs on registered external resources with child scopes beside managed data: native calls and accessor writes, failures, rejected arguments and values, scope and root poison, repair, Error queries, dynamic keys, a second context, competing registrations, an unselected alias, an observation-only identity, and mutable, read-only, nested, and mixed entries. Checks the order of every native call, exact Error identities, and that no reservation remains at quiescence. |
| [fixtures/ownership-interactions.js](fixtures/ownership-interactions.js), [ownership-destinations.js](fixtures/ownership-destinations.js) | Production handoff, captured identity, retirement/reactivation, source GC, and discarded-output GC regressions. |
| [fixtures/ownership-lifecycle.js](fixtures/ownership-lifecycle.js) | 288 queued mutation/root-clearing cases and 112 supported reflection-failure scenarios. Checks retained values and retirement of every observed admitted identity, including private copies and backing records, across indexed/unindexed controls. Runs with publication instrumentation in a bounded child process; failure coverage is asserted wherever traversal is required, while indexed acyclic queries must use their summaries without reflection. |
| [fixtures/ownership-work.js](fixtures/ownership-work.js), [array-point-work.js](fixtures/array-point-work.js) | Read-only instrumentation of production work: constructor reception, cached reactivation, backing history, extension, and point-write copying. Counts all backing-owner iteration and bounds repeated extension while retaining every produced view. Eighteen additional histories at sizes 16/64/128 check abandoned cyclic publication destinations and discarded/retained Array length subscriptions, with constant and growing pending frontiers; allocation, notification, traversal and copying have linear bounds. These state/work checks make no GC-collection claim. |
| [invocation-inputs.test.js](invocation-inputs.test.js) | Prepared argument delivery across Array payloads, managed/external calls, String coercion, aliases, cycles, and views; unused-root closure (including empty `fill` ranges checked against native behavior), single preparation, and independent shared settlement. |
| [ownership-isolation.test.js](ownership-isolation.test.js) | Displaced queued writers with retained owners and read-only entries; pending Array growth competing with sibling push, concat, or indexed extension, including offsets, holes and no-op/deletion outcomes. Overlapping reservations complete in either order after source release; creation followed by deletion still preserves length and holes. A bounded table mutates both Array owners sharing a repeated cyclic child, captures old/new managed needles for all three identity searches, and compares detached values and alias/cycle topology before and after mutation. Covers runtime/imported data, ready/synchronous/native/ordered delivery, direct/entered writes, source release and indexed/bare controls. Its independent path-local model preserves initial shared identities rather than cloning each owner. Invocation input tests also cover receiver-ancestor arguments and fresh wrappers captured before mutation. |
| [runtime-boundaries.test.js](runtime-boundaries.test.js), [fixtures/completed-work-retention.js](fixtures/completed-work-retention.js), [fixtures/length-fork-work.js](fixtures/length-fork-work.js) | Audit regressions for Error/prototype boundaries, fixed-binding recovery, unused search bounds, failed-prefix precedence, consumed-input release, and last-use GC while Errors or materialized results remain retained. Read-only length instrumentation checks point and unresolved length reads after private fork completion through COW and method-result validation copies, with shared-completion controls. |
| [browser-loading.test.js](browser-loading.test.js) | Portability checks in an isolated Node VM: relative ESM imports, standard JavaScript globals, and zero reads of a tracked `process` getter. Exercises ready and pending join overflow and subsequent healthy operations. Real browser-engine coverage belongs to the separate browser suite. |
| [representation-identity.test.js](representation-identity.test.js) | Timing-independent identity through native observation materialization: receiver/descendant/wrapper results, records/classes, imported/runtime data, views, record order, aliases/cycles, later native calls, source mutation, argument export, and required per-representation reflection failure. |
| [managed-capture.test.js](managed-capture.test.js), [fixtures/managed-capture-work.js](fixtures/managed-capture-work.js) | Logical receiver captures across physical representations, delayed alias delivery, record order, Array growth/holes, and failure during required Error collection. Read-only instrumentation checks one capture per logical node with unchanged native copying. |
| [fixtures/continuation-failure.js](fixtures/continuation-failure.js) | Callback and retirement defects escaping valid operations, including deferred retirement and competing defects. Covers ready, synchronous, native Promise, OrderedThenable, and ChainedThenable delivery; verifies the first fatal, causal source, sibling rejection, single reporting, and graph-depth balance. |
| [fixtures/outward-completion-failure.js](fixtures/outward-completion-failure.js) | Injects an internal defect at final import, lookup, call, entry, and expression completion; both affected and sibling pending results must reject with the authoritative fatal, reported once. |
| [fixtures/internal-stage-failure.js](fixtures/internal-stage-failure.js), [fixtures/entry-failure.js](fixtures/entry-failure.js) | Faults during indexing, logical publication, export copying, Array length capture, remap adoption, mutation isolation, and property validation. Covers ready, synchronous, native, ordered, and chained delivery with raw Error, escaping poison, non-Error, and existing FatalError causes; checks causal source, report count, pending siblings, balanced graph transitions, and imported-data protection. |
| [external-then-probe.test.js](external-then-probe.test.js), [managed-then-probe.test.js](managed-then-probe.test.js), [external-array-length-boundaries.test.js](external-array-length-boundaries.test.js), [array-view-action-boundaries.test.js](array-view-action-boundaries.test.js) | Public-operation controls for non-callable Error-valued `then`, observed FatalError candidates, recoverable probe throws, and ready/pending native Array length actions. Checks that descriptor reflection and backing reads cannot be followed by separate coercion or physical writes after fatality commits. |
| [fixtures/detached-cleanup-failure.js](fixtures/detached-cleanup-failure.js), [owner-finalization-failure.js](fixtures/owner-finalization-failure.js) | Runtime cleanup defects during ready/pending delivery, owner closure, registered release, and discarded export output. Covers raw Errors, escaping poison, and non-Error throws; verifies causal fatality, pending sibling rejection, first-fatal preservation, and containment after an already committed fatal. Completed non-blocking mutation issuance keeps its result while later finalization reports fatality. |
| [fixtures/publication-rejection-audit.js](fixtures/publication-rejection-audit.js), [argument-preparation-failure.js](fixtures/argument-preparation-failure.js) | Normalized publication and argument-preparation rejection must fail the execution, while raw graph/input rejection keeps its first causal attribution. Covers context initialization and stored assignments with and without readers, native Promises and synchronous/ordered/chained thenables, converted and retained payload inputs, and later Array length conversion of retained data. |
| [join-failure-boundaries.test.js](join-failure-boundaries.test.js), [fixtures/join-internal-failure.js](fixtures/join-internal-failure.js) | Ready and deferred join overflow and unsupported primitive conversion remain recoverable; defects in join preparation, the captured join intrinsic, and trusted string/number conversion fail the execution and reject pending siblings. |
| [fixtures/conflict-matrix.js](fixtures/conflict-matrix.js) | Every predecessor/queued/queued triple on one placement, with a sibling as an order and length witness. |
| [verify-refcounts.js](verify-refcounts.js) | The common consistency check: it recounts refcount indexes, reciprocal parent/child links, and cycle cuts, then runs the storage oracle. Call it wherever a test checks maintained state. |
| [verify-parents.js](verify-parents.js) | Independently checks forward logical storage, raw backing occurrences, active owner registration, and the counter projection, including storage hidden by bounds and overlays. Rejects retired parents and leftover retired summaries. `verifyLiveness` additionally compares activity with a scenario-supplied expected live set. Recognizes unavailable children through installed publication dependencies without inspecting `then`. Runs first from `verifyRefCounts`, before any normalizing read, and works before counter indexing. |
| [trace-runtime.js](trace-runtime.js) | Test-only source instrumentation for publication, construction, low-level writes, and admission. Detects untracked writes, first child admission through ordinary reads of initialized owners, and host actions or subscriptions during preparation commit. Production code contains no tracer hooks. |
| [verify-storage.js](verify-storage.js) | The storage oracle: no installed version may claim absent storage over a physical placement, and Array bounds, logical overlays, and physical storage must agree. The parent oracle independently checks backing occurrences and active owner registration. [verify-storage.test.js](verify-storage.test.js) shows the common check rejects corrupted facts. |
| [storage-settlement.test.js](storage-settlement.test.js), [publication-failures.test.js](publication-failures.test.js) | Bounded storage-failure matrices: optional Promise synchronization versus required mutation publication, direct and nested entry routes, records/Arrays, indexed/unindexed data, repair, Error preservation, and fatal precedence. Follow-up mutation runs before diagnostic observation can introduce sharing or indexing. |

Generated programs and matrices use an independent model derived from the contracts, never from the implementation, and compare every captured and final observation with it. Graph models must preserve shared identities across roots; independent deep copies can hide identity bugs. The preparation, Array, nested, and external fixtures run each program in three modes; the matrix does so for a sample of its cases and for every case in its full run:

- `observed`: initialize the live index, run consistency verifiers between commands and settlement turns, and issue optional diagnostic reads.
- `verified`: retain indexing and verification, but omit those diagnostic reads.
- `bare`: omit initial indexing, intermediate verifiers, and diagnostic reads. Operations under test, including Array observation methods, retained views, and reads inside entries, remain part of the program and may themselves index or share data.

All modes check their results against the model and must agree on final state. Verifiers are active observers: property reads can consume lazy thenables, so the bare control is necessary even when optional lookups are disabled. Their Mocha tests run each fixture in a child process with time and heap limits, because a regression can livelock the microtask queue and stop Mocha's own timeout. The sampled matrix checks every settlement microtask only in selected cases; its full run does so throughout its instrumented modes.

Random generation rarely assembles a specific multi-step trigger. Keep an explicit regression for every discovered trigger, and cover short conflicts exhaustively in the matrix.

`npm run test:ownership-model` runs the separate bounded ownership algorithm model in [experiments/phase2-retirement.mjs](experiments/phase2-retirement.mjs). It compares reverse retirement with a forward-root oracle; it does not exercise production code. Keep it alongside the production lifecycle, publication-work, and GC witnesses, and rerun it when changing the ownership algorithm.

`npm run test:safeguards` checks that the suite would notice each registered ownership safeguard disappearing. [safeguards/registry.mjs](safeguards/registry.mjs) lists one in-memory source fault per safeguard together with the tests that must fail; `run.mjs` applies each fault through a loader hook (no files change) and reports the entry as witnessed, open, lost, or stale. By default it runs only an entry's listed witnesses, which takes seconds, and falls back to the whole suite when they pass. `--full` runs the whole suite for every entry to list all affected tests; faults that leave work pending make such runs take tens of minutes. Pass entry ids to check a subset. Record a new regression's title in its entry, and update or delete the entry when the guarded code moves or the safeguard is removed. [Coordinating audits](../docs/prompts/phase2-review-guide.md#coordinating-audits) describes how reviews use it.

## Deferred identity conformance

[known-issues/phase4-identity.mjs](known-issues/phase4-identity.mjs) and [known-issues/boundary-histories.mjs](known-issues/boundary-histories.mjs) retain strict executable witnesses for the open [N1 and N2 findings](../docs/runtime-evolution-plan.md#n1-entry-no-op-identity):

```sh
npm run test:known-issues
# For automation: require exactly the recorded failures and no skips.
npm run test:known-issues:check
```

These 88 cases currently produce 36 passes and 52 failures: four N1 failures, sixteen original N2 failures and 32 additional N2 histories combining pending cached results with mutation and release. Search checks exercise all three identity methods; exports verify aliases and cycles; managed receivers and batch native arguments check identity inside calls. The additional histories collect every issued check before reporting failures and still check final effects and host storage. Settled-result and ordinary-import controls use the same strict expectations.

Default active-root histories settle pending method-result/host-call validation before second reception, explicitly recording `settled-reentry`. Their release labels do not imply that the payload remains pending. True pending repeated-root histories remain in the strict deferred suite; retired-root histories test pending re-entry while retaining only the original child.

The strict command exits nonzero while the deferred fixes remain outstanding. The check command compares every test title, test/pass/skip counts and every failure's assertion operator, code and message with [known-issues/baseline.json](known-issues/baseline.json); new failures, changed symptoms, missing cases and unexpected passes fail the check. A matching baseline means **known debt unchanged**, never passing conformance. These files remain outside `npm test`'s `*.test.js` pattern. Move fixed witnesses into the default suite and update the baseline when fixes land; never weaken expectations or add `.skip`.

The default suite retains the opposite controls: [ownership.test.js](ownership.test.js) captures searches and exports before a delayed effective entry finishes, requiring the old and changed generations to remain distinct. [input-preparations.test.js](input-preparations.test.js) requires method-result validation that rejects a borrowed capability to remain distinct from its unchanged source. These catch speculative identity merging without relying on a later export to repair an already delivered search result.

## Scaling generated runs

Run the same suite with publication instrumentation when changing graph producers or receiving boundaries:

```sh
node --import ./test/trace-runtime.js --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js "test/**/*.test.js"
```

The loader instruments named helpers, including the edge-neutral pending mutation-version installation. Detached export writes and deliberate internal fixture setup are explicitly scoped. `publication-trace.test.js` proves sensitivity by omitting one boundary in an isolated load; it also runs discarded-construction GC and preparation work-count fixtures. The GC fixture keeps an inspection Error observable while proving that pending callbacks and Error stack frames do not retain the failed input. Use `--import ./test/trace-runtime.js` on direct sequence and matrix commands too: child fixture processes do not inherit their parent’s loader arguments automatically. The incoming oracle uses independent forward descriptors, Array bounds, and overlays rather than the preparer’s key filter.

Default generated runs stay bounded. Before merging changes to shared transition mechanisms, such as placement publication, entry, external reservations, Array length, or structural methods, also run them at a larger scale with these settings:

| Setting | Effect |
| --- | --- |
| `CASCADA_SEQUENCE_SEEDS=n` | Seeds for the sequence fixtures (default 16): 4 cases each for placement sequences; 6 programs each for Array, nested and external sequences; 8 reception programs plus 1 lifecycle program for input preparation, in addition to its fixed 128 reception cases; and 32 active boundary histories per seed plus 128 fixed retired-root histories. Boundary histories require at least 4 seeds. |
| `CASCADA_SEQUENCE_START=i` | First program to run in the Array, nested, or external fixture; use it with the index a failure reports. |
| `CASCADA_CONFLICT_MATRIX=full` | The complete conflict product in all three harness modes, with checks after every microtask turn in the instrumented runs. |
| `CASCADA_CONFLICT_PART=i/n` | Runs every n-th case starting at i, to split a full matrix across processes. |

Run a fixture directly to use `CASCADA_SEQUENCE_START` or `CASCADA_CONFLICT_PART`; the Mocha tests remove them so their coverage assertions stay meaningful:

```sh
# About 20 seconds.
CASCADA_SEQUENCE_SEEDS=400 node --unhandled-rejections=strict test/fixtures/array-sequences.js
# About two minutes across eight processes; prints any failing part.
for part in 0 1 2 3 4 5 6 7; do
    CASCADA_CONFLICT_MATRIX=full CASCADA_CONFLICT_PART=$part/8 node --unhandled-rejections=strict \
        test/fixtures/conflict-matrix.js > matrix-$part.log 2>&1 || echo "part $part failed" &
done; wait
```

A fixture prints a coverage summary on success. On failure it exits non-zero and reports what reproduces the case: the seed and program, or the matrix case, including the harness mode. The fixtures are deterministic, so the same command and settings fail again.

## Extending the tools

When a feature adds an operation, a placement state, a representation, or a route:

1. Add its semantics to the relevant model from the contract. Add a model self-check for each transition whose meaning the contract fixes.
2. Add the operation to the generators and, where it can conflict with queued work, to the matrix's predecessor or queued commands; the matrix test asserts the number of command triples, so update that count too.
3. Record coverage keys after successful assertions for important **joint combinations**, and independently enumerate required keys in the wrapper tests. Separate counters for pending delivery, aliases and mutation do not prove they occurred together. Cover short multi-boundary histories, including capture, owner release, retirement/re-entry and a later consumer.
4. Add a verifier check when it introduces a persisted derived fact or a secondary representation that public behavior can mask. Run it from `verifyRefCounts`, so every existing verification point covers it, and add a test showing the common check rejects a corrupted state.
5. Show that each new check fails on a representative incorrect outcome, for example against the previous commit or a deliberate mutation in an isolated copy.
6. Replay equivalent histories with ready, synchronous and deferred delivery, comparing data, identity and effects with independent expectations. Keep default runs bounded, and run large seeds and the full matrix before merging shared-transition changes.

When semantics change, check every normative claim about the changed behavior against [data-limitations.md](../docs/data-limitations.md), then update the plan, architecture guides and test models that depend on it. Link to the authoritative rule where possible; do not add tests that merely pin document wording.

## When a generated test fails

1. Reproduce it with the same command and settings; start the Array fixture at the reported program with `CASCADA_SEQUENCE_START`.
2. Decide from the contracts whether the runtime or the model is wrong. Change a model only where it contradicts a contract, never to match the implementation.
3. Reduce the failure to the shortest command sequence that still fails, and keep it as an explicit regression next to the related tests.
4. After the fix, rerun the generated tests at the larger scale: a fix can displace a problem into a neighboring case.

## Harness rules

Tests import runtime operations directly and pass an explicit context. Related Chains and observations share that context's execution; tests of execution isolation create separate contexts deliberately. `test/support.js` provides assertions and diagnostic utilities, without an ambient execution or runtime facade. An indexing fixture creates a Chain holder explicitly before building counters: indexing itself does not receive or retain the graph.

These rules keep generated evidence valid; [the audit prompt](../docs/prompts/audit.md) explains them:

- Issue each observation synchronously at its program position and keep its result. An observation issued later observes a later state.
- Capture command payloads independently: deferred runtime callbacks and the model must use the same inputs, even after another command is issued.
- Identify Errors by their operation source and exact supplied cause, then check kind and required reference preservation. Never infer an Error's identity from the expected answer. The external fixture uses [external-error-oracle.js](external-error-oracle.js) for these checks, including failures first seen after a write has returned.
- Handle every returned Promise; the suite fails on unhandled rejections.
- Settle to quiescence, including holds that callbacks create, before reporting a blocked result.
- Classify each run locally and report its seed and program. Never let a global handler absorb a harness failure.
- Accept several outcomes only where a contract names them, such as a write that returns a ready failure but `undefined` when suspended ([runtime-spec.md](../docs/runtime-spec.md), `assignPath`). Otherwise derive the single outcome from the contracts. Keep known defects as failing witnesses; if a case must temporarily be excluded, identify the defect, report the exclusion separately from passing coverage, and retain the strict expectation. Never accept incorrect behavior merely to keep a run green.
- Use `createRandom` from the native-equivalence helpers. Reducing a simple linear congruential generator with a small modulus correlates supposedly independent choices.
- Assert coverage of important combinations instead of trusting a large run count.
