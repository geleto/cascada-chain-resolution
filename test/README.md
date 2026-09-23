# Tests

`npm test` runs every `test/**/*.test.js` file with Mocha, `test/setup.js`, and strict unhandled rejections. To run one file:

```sh
node --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js --require ./test/setup.js test/verify-storage.test.js
```

## Kinds of tests

Prefer integration tests through public operations, as [AGENTS.md](../AGENTS.md#verification) describes. The suite adds several tools for evidence that single examples cannot provide:

| Tool | Use it for |
| --- | --- |
| [native-equivalence-support.js](native-equivalence-support.js) | Behavior meant to match native JavaScript, such as property, Array, and String semantics. |
| [fixtures/placement-sequences.js](fixtures/placement-sequences.js) | Seeded programs on one placement, checked against a sequential model with rollback. |
| [fixtures/array-sequences.js](fixtures/array-sequences.js) | Seeded Array programs: element entries, direct commands, failure and repair, length, structural methods, and observations issued directly, inside read-only entries, or on lookup snapshots. |
| [fixtures/conflict-matrix.js](fixtures/conflict-matrix.js) | Every predecessor/queued/queued triple on one placement, with a sibling as an order and length witness. |
| [verify-refcounts.js](verify-refcounts.js) | Recounting refcount indexes, parent edges, and cycle cuts. |
| [verify-storage.js](verify-storage.js) | Checking that no installed version claims absent storage over a physical placement; [verify-storage.test.js](verify-storage.test.js) shows it rejects a corrupted fact. |

Generated programs and matrices use an independent model derived from the contracts, never from the implementation, and compare every intermediate and final observation with it. The Array fixture runs each program with and without intermediate reads, and the matrix pairs a sample of its cases the same way; both run the verifiers between settlement turns. Their Mocha tests run each fixture in a child process with time and heap limits, because a regression can livelock the microtask queue and stop Mocha's own timeout.

Random generation rarely assembles a specific multi-step trigger. Keep an explicit regression for every discovered trigger, and cover short conflicts exhaustively in the matrix.

## Scaling generated runs

Default runs stay bounded: the generated tests add about 4 seconds to `npm test`. Before merging changes to shared transition mechanisms, such as placement publication, entry, Array length, or structural methods, also run them at a larger scale with these settings:

| Setting | Effect |
| --- | --- |
| `CASCADA_SEQUENCE_SEEDS=n` | Seeds for the sequence fixtures (default 16): 4 cases each for placement sequences, 6 programs each for Array sequences. |
| `CASCADA_SEQUENCE_START=i` | First Array program to run; use it with the index a failure reports. |
| `CASCADA_CONFLICT_MATRIX=full` | The complete conflict product in both harness modes, verified after every microtask turn. |
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

A fixture prints a coverage summary on success. On failure it exits non-zero and reports what reproduces the case: the seed and program, or the matrix case. Both fixtures are deterministic, so the same command and settings fail again.

## Extending the tools

When a feature adds an operation, a placement state, a representation, or a route:

1. Add its semantics to the relevant model from the contract. Add a model self-check for each transition whose meaning the contract fixes.
2. Add the operation to the generators and, where it can conflict with queued work, to the matrix's predecessor or queued commands; the matrix test asserts the number of command triples, so update that count too.
3. Record coverage keys for its important combinations and assert them in [generated-sequences.test.js](generated-sequences.test.js), so a later generator change cannot drop them silently.
4. Add a verifier check when it introduces a persisted derived fact or a secondary representation that public behavior can mask, with a test showing the check rejects a corrupted state.
5. Show that each new check fails on a representative incorrect outcome, for example against the previous commit or a deliberate mutation in an isolated copy.
6. Keep the default runs to a few seconds, and run large seeds and the full matrix before merging.

## When a generated test fails

1. Reproduce it with the same command and settings; start the Array fixture at the reported program with `CASCADA_SEQUENCE_START`.
2. Decide from the contracts whether the runtime or the model is wrong. Change a model only where it contradicts a contract, never to match the implementation.
3. Reduce the failure to the shortest command sequence that still fails, and keep it as an explicit regression next to the related tests.
4. After the fix, rerun the generated tests at the larger scale: a fix can displace a problem into a neighboring case.

## Harness rules

These rules keep generated evidence valid; [the audit prompt](../docs/prompts/audit.md) explains them:

- Issue each observation synchronously at its program position and keep its result. An observation issued later observes a later state.
- Handle every returned Promise; the suite fails on unhandled rejections.
- Settle to quiescence, including holds that callbacks create, before reporting a blocked result.
- Classify each run locally and report its seed and program. Never let a global handler absorb a harness failure.
- Use `createRandom` from the native-equivalence helpers. Reducing a simple linear congruential generator with a small modulus correlates supposedly independent choices.
- Assert coverage of important combinations instead of trusting a large run count.
