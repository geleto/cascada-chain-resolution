# Runtime implementation plan

**Status:** Implemented. This document records the intended end state, not the
intermediate designs used to reach it.

## 1. Sequential asynchronous graph semantics

- Process all available work synchronously.
- Register every operation that depends on a pending property at its exact
  program position on the canonical Promise.
- Complete each FIFO continuation as one synchronous transition.
- Return direct results whenever no captured frontier remains pending.

## 2. Property versions

- Represent each Promise-backed property version with one `PromiseMirror`.
- Create a new version for every assignment, copy, or distinct logical
  placement, even when the Promise identity is unchanged.
- Keep the version's authoritative logical state in the mirror's single `value`
  field.
- Write live runtime-owned advancement through to the physical property, while
  imported and detached versions remain mirror-only.

## 3. Ownership and import

- Keep new Cascada data singly owned until another owner is established.
- Mark reused identities shared and copy before mutating a shared path.
- Treat imported data as borrowed and never modify it, including metadata.
- Store one `{ errorContext }` token per import and reference it directly from
  each newly imported identity.
- Let containment preserve, rather than transfer, identity classification.
- Discover imported Promise placements immediately, but add no consumer merely
  to inspect structure.

## 4. Copy-on-write

- Copy only the target path, beginning at the first shared, imported, leased,
  or otherwise preserved container.
- Make every copied container runtime-owned and rebuild its metadata from its
  logical properties.
- Mark reused children shared and fork copied Promise properties at the copy's
  FIFO position.
- Retain only the first copied root when pending attachment work must preserve
  the operation's issue-time world.

## 5. Cycles and subtree counters

- Accept cycles in every language graph.
- Build counters lazily only for branches queried by counter-based operations.
- During initial indexing, cut DFS back edges and index cut targets as separate
  components.
- Before publishing a tracked value into an indexed container, index it and
  use the reverse-parent DAG to decide whether the new edge closes a cycle.
- Publish value, cut, reverse edges, and count deltas in one synchronous
  property transition.
- Never put cycle detection in import, Promise, or operation-specific code.

## 6. Observations

- Resolve finite paths through captured mirrors without changing ownership for
  pure reads.
- Use exact Promise, Error, and cut totals to fence `hasError` and `getErrors`.
- Continue across cut targets with one operation-local visited set.
- Export through an identity-aware raw walk that preserves aliases and cycles
  and does not depend on the refcount projection.

## 7. Entered and native operations

- Use `enter` to give callbacks a scoped private Chain and publish mutating work
  through an ordinary Promise gate.
- Transfer pending targets by sampling the detached source mirror at the
  transfer's FIFO position.
- Restrict `run` to supported data-only String and Array operations and trusted
  read-only methods.
- Route their publications through the same ownership, mirror, and indexed-edge
  rules as path assignment.

## 8. Failure and verification

- Convert rejected data Promises to language Error values.
- Report invariants, integration violations, and unexpected throws as fatal.
- Run the complete suite with inline and WeakMap metadata.
- Independently verify counter totals, raw index closure, mirror and cut shape,
  reverse-edge multiplicity, and parent-DAG acyclicity.

Detailed contracts live in:

- [`runtime-spec.md`](runtime-spec.md)
- [`import-preparation.md`](import-preparation.md)
- [`counters-implementation.md`](counters-implementation.md)
- [`cycles-as-data.md`](cycles-as-data.md)
- [`enter.md`](enter.md)
- [`run.md`](run.md)
