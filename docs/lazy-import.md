# Recursive import and lazy validation (issues.md item 4)

Import recursively marks the language-visible external graph as imported and shared,
and immediately registers on every promise it reaches. A settled promise value enters
the same walk, using the same per-import identity state, before later mirror consumers
can write it back. Import still performs no validation, counter work, or mirror
minting: those remain at counting time and promise discovery respectively.

The SHARED mark answers "who else can see me", the counters answer "what is pending
below me", and the import marker answers "where did this come from". Materializing the
mark on imported descendants also lets branch queries visit imported DAG identities
once rather than once per path.

---

## 1. Separation from validation and writeback

The import walk does exactly three things: record provenance, materialize sharing,
and register recursive promise continuations. It does not validate cycles, frozen
rules, or `__proto__`; `validateCountable` still owns those checks when counters are
needed. It also does not create promise mirrors or replace promise-valued properties.
Mirrors remain the sole writeback mechanism, preserving their FIFO and private-world
semantics.

## 2. The import marker

One new field in the META record:

```js
importContext: undefined,   // undefined = not imported; string = imported, attribution
```

The marker value IS the error context — in Cascada a context object (line, file, …),
in this sandbox a string. **The context is required and non-null**: null and undefined
are rejected, and `importContext === undefined` remains the "not imported" sentinel
that gates provenance propagation. A context-less import would silently disable import
semantics (unflavored mirrors, settled external values entering as owned). That is a
compiler bug, not language data, so `import` throws on a missing context.

Non-extensible values cannot carry inline Symbol META, but their attribution must
survive (they are exactly the values most likely to fail counting validation).
When `STORE_META_IN_WEAKMAP` is true, they use the normal META record. In inline
Symbol mode, a scoped side table covers them: written only by `markImported`,
consulted only by `nodeImportContext` on its non-extensible branch — never on the
`hasSharedMark` hot path.

```js
const frozenImportContexts = STORE_META_IN_WEAKMAP ? null : new WeakMap()

function markImported(value, importContext) {
    if (!isTracked(value)) return value
    if (!Object.isExtensible(value) && !STORE_META_IN_WEAKMAP) {
        if (!frozenImportContexts.has(value)) frozenImportContexts.set(value, importContext)
        return value
    }
    const meta = ensureMeta(value)
    meta.importContext ??= importContext     // first import wins
    meta.shared = true                       // imported data is never owned
    return value
}

// The context a walk should carry after touching this node.
function nodeImportContext(node, inherited) {
    const own = metaOf(node)?.importContext
    if (own !== undefined) return own
    if (!STORE_META_IN_WEAKMAP && isTracked(node) && !Object.isExtensible(node)) {
        return frozenImportContexts.get(node) ?? inherited
    }
    return inherited
}
```

Non-extensible nodes are implicitly shared. Imported non-extensible nodes keep
their context in META under WeakMap storage, or in the side table under inline
Symbol storage. The recursive import walk marks interior frozen nodes directly;
inherited context remains the fallback for values introduced by later runtime paths.

## 3. import — the whole operation

```js
function importValue(value, errorContext) {
    if (errorContext === undefined || errorContext === null) {
        // Fatal runtime configuration / compiler error — never a language Error:
        // a default here would mask the compiler bug and silently drop provenance.
        reportFatalError(new Error("import requires an error context"))
    }

    const seen = new WeakSet()
    return importBranch(value)

    function importBranch(value) {
        if (isPromise(value)) {
            if (seen.has(value)) return value
            seen.add(value)
            return onValueResolve(value, importBranch)
        }
        if (!isTracked(value) || seen.has(value)) return value

        const pending = [value]
        while (pending.length > 0) {
            const current = pending.pop()
            if (isPromise(current)) {
                if (seen.has(current)) continue
                seen.add(current)
                onValueResolve(current, importBranch)
                continue
            }
            if (!isTracked(current) || seen.has(current)) continue

            seen.add(current)
            markImported(current, errorContext)
            const keys = Object.keys(current)
            for (let index = keys.length - 1; index >= 0; index--) {
                pending.push(current[keys[index]])
            }
        }
        return value
    }
}
```

The synchronous cost is O(unique reachable nodes and promises). Import returns the
original non-promise value immediately; a promise root returns the derived promise as
before. Nested promise continuations are registered but not awaited. The shared
`WeakSet` spans the initial walk and every recursively exposed promise branch, so DAGs
and cycles terminate and each promise is registered once. Cycles remain accepted until
counting validation rejects them. Promise properties are not rewritten by import.

## 4. Marker propagation — the invariant

**Every language-reachable entry point into imported data carries the marker.**
Import materializes it throughout the graph, and runtime transformations preserve it.

1. **Import traversal** — every synchronously reachable tracked node is marked
   imported and shared. Every reached promise is registered immediately; its settled
   value and recursively exposed promises re-enter the same traversal before later
   mirror consumers run.

2. **Extraction (`lookupPath`)** — the walk threads the inherited context
   (`nodeImportContext` per level); an escaping value from inside an imported region
   is marked **even when `sharedOwnership === false`** (an ownership-transferred
   external branch is still external). `markImported` sets shared too, so the
   marking calls collapse to:

   ```js
   if (importContext !== undefined) markImported(value, importContext)
   else if (sharedOwnership) markShared(value)
   ```

3. **COW (`shallowCopy`)** — a copy of an imported node marks **all** reused tracked
   children with the context, including the path-key child (unlike shared marking:
   imported data must COW regardless, so the owned-path-key optimization does not
   apply to it). The copy itself is language-owned and unmarked; provenance lives on
   the reused content.

4. **Settle boundaries (mirrors)** — a mirror created inside an imported region
   captures the context for its resolved value in the writeback continuation,
   and marks the settled value before any consumer can observe it:

   ```js
   let value = forkSourceMirror === null
       ? settledValueOrError
       : forkSourceMirror.currentValue
   if (importContext !== undefined) {
       markImported(value, importContext)
   }
   else if (markResolvedValueShared && isTracked(value)) markShared(value)
   ```

   Discovery passes the walk's inherited context; forks capture the COW walk's
   imported context; ref-indexing passes the commit walk's inherited context to
   `getOrCreatePromiseMirror(node, key, promise, importContext)`.

5. **Language integration (issues.md item 11)** — the compiler routes external values
   through `import(value, ctx)` and marks extracted branches
   (`var x = getExternalValue().a`), constructing the context at the call site.

Walk threading: `lookupPath` carries `importContext` exactly like
`inheritedSharedBranch`. `walkMutationPath` re-derives import context from each
reached node before COW; flavored mirrors and COW child marking make resumed
remainders recover the context from own markers instead of threaded state.

## 5. `__proto__`: forbidden key

Runtime writes stay simple: `node[key] = value`. The language-visible object
surface is own enumerable string keys. The host-language legacy key `__proto__`
is forbidden instead of being supported with a special write primitive.

- `lookupPath` treats `__proto__` and own non-enumerable properties as missing.
- `assignPath` and `deletePath` throw for `__proto__` path segments. Owned
  non-enumerable properties throw, while shared/imported branches COW before
  the check so non-enumerables are shadowed as missing.
- `validateCountable` rejects an imported own enumerable `__proto__` key when the
  branch first enters the counted world.
- `shallowCopy` pre-creates an own enumerable `__proto__` data slot on the copy
  before plain assignment, so odd external data is preserved without touching
  the prototype.

This keeps the common write path readable and avoids JS prototype mutation without
a special write primitive.

## 6. Validation collapses to one site: counting

The single remaining validator, in `validate.js`, pure, used only when a branch
enters the counted world:

```js
// Everything counting requires, nothing more:
// - back-edge: value must not reach writeTarget (a write-created cycle must
//   pass through the written parent) — checked before any skip/early-exit
// - cycles: two-color (visiting = cycle, visited = DAG share)
// - frozen rule: a non-extensible node must not contain promises or Errors
//   anywhere beneath (its subtree is decreed [0,0] — the counts would lie)
// importContext (from markers, via nodeImportContext) rides along so failures
// read: "Imported data is cyclic (imported at: <ctx>)".
function validateCountable(value, writeTarget) -> Error | null
```

Notes:

- With `writeTarget` given (ref-indexed write commits), the descent takes **no
  early exits** — the target may hide behind already-indexed DAG shares. Without it
  (`buildRefIndex` from normalize/hasError), already-ref-indexed subtrees may be
  skipped: they are validated, acyclic, and downward-closed, and no cycle can pass
  from new nodes through them back out.
- The validator runs on **every** first-index and every ref-indexed write commit,
  trusted data included. Rationale: a cycle can thread *through* owned nodes (an
  in-place writeback in an uncounted region can install an imported value that
  embeds an escaped language object), so the cycle check must cover the whole
  branch — and the frozen/`__proto__`-free facts it needs are per-node O(1). One
  path, no modes; the validate pass rides a walk the commit was paying anyway.
- Getter/proxy side effects are explicitly out of scope: a developer who mutates or
  counts exotic objects through Cascada must ensure they behave as plain data.

Wiring (validate-then-commit stays two-pass — a failure must leave no partial
counters, edges, or mirrors):

```js
function buildRefIndex(value) {
    if (!isTracked(value)) return value
    if (!Object.isExtensible(value)) {
        return validateCountable(value, undefined) ?? value  // frozen root: no counters/mirrors
    }
    if (isRefIndexed(value)) return value
    return validateCountable(value, undefined) ?? (commitRefIndex(value, new Set(), undefined), value)
}

function refSetProperty(parent, key, value) {
    // gate unchanged; then:
    const failure = validateCountable(value, parent)   // O(1) for primitives
    const nextValue = failure ?? commitBranch(value)   // commit-only, cannot fail
    // deltas and edge swap as today, on nextValue
}
```

Walk budget, stated exactly: an entering value pays **two** passes — the pure
validate pass and the infallible commit pass; that split is the transactionality
guarantee and is not fusable without reintroducing rollback. There is no third
walk: after commit, `getRefCounts` is an O(1) counter read and treats a missing
tracked-value counter as a fatal downward-closure violation.

Failures surface by operation semantics, with attribution: ref-indexed write →
Error committed at the key; `normalize` → returns the Error; `hasError` → true.
`getRefCounts` keeps its fatal invariant check — inside a counted region every
tracked extensible value was validated and ref-indexed before it became observable.

**Deliberately accepted:** for non-ref-indexed targets a back-edge writeback commits
uncaught, and the cycle floats in the uncounted region (all walks are path-bounded —
harmless). It is rejected, with import context, when counting first reaches that
region. Lazy error attribution moves diagnosis from the import site to first use;
the errorContext exists precisely to point back.

## 7. Frozen data: graceful everywhere, rejected only by counting

A frozen node can never advance (no mirrors can attach, no writeback can replace
its keys), so its raw settled promise values are the only versions that will ever
exist. That makes two paths sound *without* mirrors:

- **Reads** (`lookupPath` reaching a promise key on a non-extensible holder): resolve
  mirror-free — `onValueResolve(value, v => lookupValue(v, index, ctx))`. No advance is
  possible, so the raw value is program-order-correct for every reader.
- **COW forks** (`shallowCopy` of a frozen source with a promise key): mint the
  copy's mirror seeded from the raw promise (`v => v`) instead of a source mirror —
  the copy is extensible and behaves like normal data from then on. **The
  raw-seeded mirror takes the walk's current import context**: when the frozen
  source is imported, there is no source mirror to seed from. Left unflavored,
  the mirror's settled external value would enter
  the copied world as owned data, breaking COW safety.

Only **counting** rejects frozen-with-promise/Error (§6): you cannot wait on or
count what hides beneath a `[0,0]`-by-decree node. So: observe it freely, copy it
into mutable data freely, `normalize`/`hasError` it → Error/true with attribution.

## 8. Affected operations — summary table

| site | change |
|---|---|
| `import(value, errorContext)` | recursively marks the external graph, registers unique promises, and processes their settled branches; no validation, mirrors, or property writeback |
| `lookupPath` | threads importContext; marks extraction even for `sharedOwnership=false`; mirror-free reads through frozen holders |
| `walkMutationPath` | re-derives importContext at each reached node; passes it to COW and attributed mutation errors |
| `shallowCopy` | preserves own enumerable `__proto__` as data before plain assignment; marks all reused tracked children with context; forked mirrors capture the COW walk's context; raw-seeded forks for frozen sources do the same |
| mirrors | writeback captures import context at mirror creation and marks settled value; `getOrCreatePromiseMirror(node, key, promise, importContext)` is used by walks and ref-indexing |
| `setProperty` | throws before own non-enumerable keys on the object being written; writes through plain assignment |
| `refSetProperty` | `validateCountable(value, parent)` before commit; Error committed at key |
| `buildRefIndex` | `validateCountable(value, undefined)` before commit; frozen roots validated, no counters/mirrors |
| `validate.js` | rewritten to the single `validateCountable` |
| `assignPath`/`deletePath`/`lookupPath` | lookup treats `__proto__` and own non-enumerables as missing; mutations throw on `__proto__`; owned non-enumerables throw, shared/imported non-enumerables are shadowed after COW |

## 9. Behavior changes (language-visible)

1. Invalid imports (cyclic, frozen-with-promise) are accepted silently and fail at
   first counting use, permanently for that branch, with the import context in the
   Error. Previously rejected at import. Explicitly: until something counts it,
   invalid imported structure can be stored, looked up, and handed back to external
   code unrejected — `lookupPath` is identity-preserving observation, and returning
   external code its own (unchanged) structure violates no language guarantee.
   Values Cascada constructs — normalize output, counted regions — remain acyclic
   and frozen-pure. Escape boundaries deliberately do not validate; import's eager
   work is limited to metadata and promise registration.
2. Promise properties inside imported data are registered immediately for recursive
   marking. Import does not replace those properties; only a mirror discovered by a
   runtime operation can write a settled value back.
3. `__proto__` is forbidden as a language key: lookup treats it as missing,
   mutations throw, COW preserves own enumerable data keys without prototype
   mutation, and imported own enumerable keys reject at counting time.
4. Own non-enumerable properties are outside the language graph: lookup treats
   them as missing; owned mutations through them throw, while shared/imported
   branches COW first and shadow them as missing.
5. Frozen objects containing promises are readable and COW-able; only
   normalize/hasError reject them.
6. Reading through imported data preserves provenance even on
   `sharedOwnership=false` lookups; imported descendants are already shared.

## 10. Test matrix

- `import` marks every reachable tracked descendant, terminates on cyclic input, and
  registers each unique promise once; resolved values and deeper promises receive the
  same context before mirror writeback.
- Imported DAGs and aliases split across promise branches carry direct shared marks;
  hasError/getErrors traverse each identity once across promise barriers.
- `import(value)` without a context throws synchronously (fatal, not a language
  Error); the value receives no marks.
- Attribution durability for non-extensible values: a frozen direct import and a
  promise resolving to a frozen object both keep their errorContext (META in
  WeakMap mode, side table in inline mode), and a later counting rejection names
  the import site.
- Attribution: `buildRefIndex` on a cyclic/frozen-violating imported branch returns
  an Error containing the errorContext; ref-indexed write of an invalid imported
  value commits an Error at the key with context; context survives extraction, COW,
  and settle boundaries (deep chains: import → lookup sub-branch → COW → writeback →
  normalize-era validation still names the original import site).
- Propagation: extraction marks with `sharedOwnership=false`; COW marks reused
  children including the path key; fork mirrors inherit flavor; discovery inside an
  imported region marks resolved values imported+shared before consumers observe
  them (FIFO test).
- Back-edge: imported promise resolving to (a value containing) its live or revoked
  logical target under a ref-indexed parent → Error at the key or private mirror value
  with context, `verifyRefCounts` passes; same under a non-ref-indexed parent → cycle
  floats, walks terminate, later `buildRefIndex` rejects with context.
- Frozen: mirror-free read through a frozen promise key (value, rejection→Error);
  COW of a frozen source with promise key produces a normal counted-able copy;
  the raw-seeded fork mirror carries the walk's current import context — its
  settled value must arrive marked imported+shared (and a counting rejection of
  that value must name the original import site);
  counting rejects frozen-with-promise and frozen-with-Error.
- `__proto__`/non-enumerable keys: lookup returns missing; `__proto__` mutation
  throws; owned non-enumerable mutation throws; shared/imported non-enumerables
  are shadowed after COW;
  COW preserves own enumerable `__proto__` data keys without prototype mutation;
  imported own enumerable `__proto__` keys reject at counting time;
  prototypes stay untouched (pollution probe).
- Idempotence: re-import keeps the first context.
- The full existing counter matrix stays green; `verifyRefCounts` after every
  mutation in new tests.
