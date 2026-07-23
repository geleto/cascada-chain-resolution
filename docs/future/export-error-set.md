# Export with the complete Error set

**Status:** Planned after
[`cycles-as-data.md`](cycles-as-data.md); not implemented.

The target behavior is:

- a successful `export` returns the metadata-free settled branch; and
- a branch containing ordinary Errors returns the same complete set of distinct
  Error identities as `getErrors` at the corresponding captured position.

Cycles are valid data under the prerequisite design. They never enter the Error
result, but export and Error collection both follow cycle cuts so
ordinary Errors and Promises behind them remain visible.

## Do not compose public operations

Implementing this as `getErrors` followed by `export` would be incorrect:

- the second operation would register at a later program position;
- a later-issued mutation could fall between the two captures;
- `getErrors` is unpinned while export pins when it must wait; and
- the branch would be resolved, indexed, and walked twice.

One operation must own one synchronous prefix, issue-time world, settlement
generation, raw frontier, copy, and Error Set.

## Operation shape

Path resolution remains unchanged. An ordinary tracked terminal is ref-indexed;
a path ending directly at a published or private cycle cut enters raw traversal
without requiring the cut target to have a counter.

### Direct terminal

- A path-blocking or terminal Error produces a one-element Error result.
- A primitive or missing terminal returns directly as a successful value.
- A terminal cycle cut starts the same raw copy-and-Error traversal used for a
  counted branch with cuts.

### Cut-free tracked branch

When `cycleCutCount === 0`:

1. If `promiseCount > 0`, pin the branch and wait for the existing settlement
   generation.
2. At settlement, `errorCount === 0` takes the normal metadata-free copy path.
3. A positive `errorCount` runs the shared Error collector and returns the
   complete distinct set.

The counter fast paths are exact because no cycle cut caps the projection.

### Branch containing cycle cuts

When `cycleCutCount > 0`, projected Error and Promise counts may hide content
behind cuts.

If `promiseCount > 0`, pin the branch and wait for the projected settlement
generation first. The pin keeps later mutations in a different COW world while
the counted mirrors drain.

At projected settlement, run one identity-aware raw traversal that:

- constructs the metadata-free output graph;
- preserves aliases and cycles through one identity map;
- collects each ordinary Error identity into one Set;
- follows raw logical values without adding a cycle diagnostic; and
- recursively captures Promises found beyond projected frontiers.

Once raw mode starts, traversal does not inspect cut metadata. Its identity map
terminates cycles; `cycleCutCount` is only the indexed branch-level signal that
raw mode is required.

If projected settlement was synchronous and the raw prefix captures hidden
Promises, pin the issue-time branch before returning the readiness Promise. If
the branch was already pinned for projected settlement, retain that pin.
Continue the same traversal state after those Promises settle.

When the complete raw frontier is ready:

- a non-empty Error Set becomes the Error result; and
- otherwise the already constructed graph copy becomes the success result.

No second classification or copy walk is required.

## Settlement

Only `promiseCount` controls the shared counter-zero settlement generation.
`cycleCutCount` means raw traversal is required; it does not keep settlement
pending.

The operation may discover additional Promises while following raw cut edges.
Those waits are represented by the raw walk's hierarchical readiness tree. A
branch is pinned before any asynchronous result escapes, whether the initial
wait came from projected `promiseCount` or the raw cycle frontier.

Later-issued mutations therefore COW away from the captured branch. Earlier
mirror consumers drain in FIFO order before their values enter the traversal.

## Error scope

The Error result contains exactly the ordinary Error identities that
`getErrors` reaches through:

- projected indexed properties;
- Promise values captured at the operation's issue position; and
- raw values behind cycle cuts.

Repeated references to one Error produce one entry. Distinct Error objects
remain distinct. Cycle cuts themselves produce no entry.

The operation does not return on the first Error because a Promise elsewhere in
the captured frontier may expose another distinct Error.

## Marking

A synchronous success or Error result creates no new ownership mark.

An operation that must wait pins before its outcome is known. The pin remains
even if the settled result is an Error collection; removing an irreversible
shared mark after learning the outcome would be unsound.

## Result channel

A successful branch may legitimately be an array containing Error values, so
the language layer cannot distinguish success from an Error collection by
inspecting the JavaScript value shape.

Before implementation, the integration layer must define a separate result
envelope or channel for the Error outcome. That decision does not change the
kernel's traversal, settlement, or collection algorithm.

## Shared implementation

The fused traversal should reuse:

- path resolution and initial `buildRefIndex`;
- export's settlement generation and pin;
- `getErrors`' distinct Error Set policy;
- Step 17's branch-level projected/raw Error dispatch; and
- `src/raw-walk.js` for identity-preserving copy plus raw frontier extension.

Operation-specific policy remains in the export shell. Do not implement
export by calling the public `getErrors` operation.

## Required coverage

Run under inline and WeakMap metadata storage:

- synchronous clean primitive and tracked branches;
- synchronous distinct and aliased ordinary Errors;
- a path-blocking Error as the sole result;
- pending branches settling clean and with several Errors;
- clean cyclic output preserving topology;
- ordinary Errors and Promises reachable only through cycle cuts;
- alternating Promise and cycle frontiers;
- concurrent export calls sharing settlement but owning independent
  output/Error state;
- later-issued mutation COW after pinning;
- metadata-free output on every successful path; and
- an explicit result-channel test where valid output is itself an array of
  Errors.

At one captured program position:

```text
hasError(chain, path) === (getErrors(chain, path).length > 0)
```

Export succeeds exactly when both sides are false and otherwise returns
the same distinct Error identities.
