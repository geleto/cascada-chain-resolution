# Normalize with the complete error set

Requirement change: when errors are reachable, `normalize` returns the same
result `getErrors` would return — the complete set of distinct Error
identities — instead of one arbitrary Error. A clean branch normalizes as
before. This document records the fused design that implements it. Context:
`docs/counters-implementation.md`, `docs/import-cycle-model.md`, issues 6, 10,
12, and 14.

## Why not compose the two public operations

Running `getErrors` first and normalizing only a clean result is wrong in
three independent ways:

- **FIFO position.** An operation's mirror state must be captured in its
  synchronous prefix. Awaiting `getErrors` moves normalize's pin and
  registrations to a later microtask, where later-issued mutations can
  interleave between the two halves.
- **Waste.** Two path resolutions, two ref-index walks, a wait tree built
  next to a settlement generation, enumeration of branches that turn out
  clean, and a pin taken for branches synchronously known to be errors.
- **Incoherent wait semantics.** `getErrors` answers from its issue-time
  frontier without a pin; normalize answers from the pinned world's
  zero-crossing. On a pending branch the two can settle at different times
  with different world-views — one clean, the other not. No join of the two
  results is coherent.

## The fusion

The design rests on an asymmetry: **normalize's wait never was a walk.** Its
synchronous prefix is pin + settlement-generation registration — O(1), no
mirror registrations, FIFO-safe because the zero-crossing is driven by the
mirrors' own final drain commits. The only walk in the combined operation is
the error enumeration, and it runs **after zero**, where there is nothing
left to race: every counted mirror has drained, `currentValue` reads are
synchronous, and later-issued mutations have COWed away from the pinned
branch.

## Operation shape

1. **Synchronous prefix** (unchanged): resolve the path with
   `walkObservationPath`, ref-index the reached branch once. A path-blocking
   or propagated Error becomes the sole element of the error result — the
   two operations already share this path semantics.
2. **Settled, `errorCount === 0`**: success path. Mark per `sharedOwnership`
   or build the plain copy. No error machinery runs.
3. **Settled, `errorCount > 0`**: run the shared enumeration walk
   (`getErrors`' collector with the Error set) over the settled branch. Its
   counted-wait arm is dead at zero. Return the set, unmarked, no pin.
4. **Pending**: pin and register on the settlement generation, exactly as
   today. At zero, continue with case 2 or 3.

The enumeration is the same collector `getErrors` uses, so the error result's
scope is `getErrors`' scope **by construction**: under the current contract
both stop at cycle cuts; if the proposed raw collection contract in
`docs/import-cycle-model.md` is adopted, both follow raw values through cuts
and wait on the raw frontier. One decision governs both operations.

## Consequences

- **Classification disappears.** There is no mixed-versus-cycle-only
  distinction and no first-ordinary-Error early exit: `errorCount > 0` at
  zero always enumerates everything.
- **Cycle Errors now poison normalize.** Cuts contribute to `errorCount`, so
  a cycle-containing branch returns the error set — including its cycle
  Errors — never the cyclic value. The former diagnostic split ("hasError
  true while normalize succeeds") is replaced by agreement across all three
  operations. Cyclic imported data remains reachable through lookup, through
  mutation, and through normalize of a clean subpath that does not cross a
  cut.
- **The success path is provably acyclic and exhaustive.** `errorCount === 0`
  implies no cuts, so nothing is hidden and no cycles exist. Success-side
  plain copying needs only the DAG identity map; the cycle-aware success
  materialization and its raw promise frontier are removed from normalize
  entirely. The raw logical walker survives only as the error path's
  enumerator under the proposed raw scope, aligning with the item 14
  consolidation.
- **Set-completeness extends the error wait under the raw scope.** A
  complete set cannot return on the first ordinary Error: a behind-cut
  promise may still resolve to another distinct Error. On cut-free branches
  — `errorCount > 0` with no cuts, the common case — enumeration is fully
  synchronous.
- **Scope is the pinned settled world.** The error set describes the branch
  as pinned and settled, not an unpinned issue-time frontier. This is the
  coherent choice for a pinning operation; it diverges from a standalone
  `getErrors` at the same position only when a later-issued mutation touched
  the branch, which the pin itself prevents for the normalize caller.

## Marking

Unchanged rules, now stated for the set result: a settled error result
escapes unmarked and takes no pin. A pending branch pins before its outcome
is knowable and keeps the pin if it later collapses to errors — the
documented, irreversible price of an exact wait-set. Only an operation that
never waits can avoid it, and this one must wait.

## Result envelope

`getErrors` always returns an Error array, so its shape is unambiguous.
Normalize now returns either the branch value or the error collection, and a
successful branch may itself legitimately be an array of Errors. The language
layer must therefore distinguish the error result by envelope or channel,
not by inspecting the value's shape. This is a required integration decision,
not a kernel concern.

## Spec and coverage impact

`docs/initial-spec.md` (normalize: "returns a single Error", the cycle-aware
success traversal, and the hasError-true-while-normalize-succeeds example),
issue 6's collapse rules, and issue 12's cycle-operation contract must be
updated together with the implementation.

Coverage:

- Settled clean branch: unchanged success, marking per `sharedOwnership`.
- Settled ordinary errors: synchronous complete set, no mark, no pin;
  aliased identical Errors deduplicated; distinct Errors distinct.
- Settled cycle-bearing branch: set contains the cycle Errors; the cyclic
  value is not returned; host data unchanged.
- Pending branch collapsing to errors: pin retained, set complete at zero.
- Pending branch settling clean: existing mark/pin rules.
- Path-blocking Error: sole-element result, identical to `getErrors`.
- Same-position coherence: `hasError` ⟺ `getErrors` nonempty ⟺ normalize
  returns the error set, synchronously and behind promise barriers.
- Plain copy of a clean branch with DAG aliases: identity preserved with no
  cycle machinery on the success path.
- Under the raw scope: a distinct Error behind a cut included after its raw
  wait; without it, both operations stop at the same cut.
