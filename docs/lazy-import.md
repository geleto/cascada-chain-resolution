# Lazy import — design (issues.md item 4)

Import stops validating, scanning, and minting anything. It marks the value with an
**import marker carrying an error/attribution context** and returns. Everything the
eager boundary did is either deleted outright or moved to the one place that actually
needs it: **counting time**. Never-touched external data pays nothing; observation-only
use pays no validation, no scanning, and no counting — only O(1) provenance marks at
the entry points the program actually touches; and validation failures are reported
with the import site that brought the data in.

Guiding rule, same as the counters: pay only at first use, and let one mechanism do
one job. The SHARED mark answers "who else can see me", the counters answer "what is
pending below me", and the import marker answers "where did this come from" — which is
both the trust boundary and the error attribution.

---

## 1. Start by removing (no replacements yet)

Delete, together with their tests (the behaviors return in lazy form in later steps):

- `validate.js`: `validateImportBoundary` / `validateImportValue` — the eager walker,
  including its `target` back-edge parameter and the own-`__proto__` check.
- `index.js`: `screenImportBoundary`, `scanImportedValue`,
  `getOrCreateImportedPromiseMirror`, the `mirror.screenValue` hook and its fork
  propagation, and the `IMPORTED_PROMISES` WeakSet.
- `index.js`: `forbiddenPathError` and `FORBIDDEN_PATH_KEY` (superseded by faithful
  own-key writes, §5).

After this step the kernel is the trusted-data kernel plus a temporarily unguarded
import. The base suite must stay green; import-safety tests are re-added per section 8.

What stays untouched: the mirror FIFO machinery, COW/shared marking, the counter
hooks, `verifyRefCounts`, and the whole trusted-data write path.

## 2. The import marker

One new field in the META record:

```js
importContext: undefined,   // undefined = not imported; string = imported, attribution
```

The marker value IS the error context — in Cascada a context object (line, file, …),
in this sandbox a string. **The context is required**: `importContext === undefined`
is the "not imported" sentinel that gates all provenance propagation, so a
context-less import would silently disable import semantics (unflavored mirrors,
settled external values entering as owned). That is a compiler bug, not language
data — `import` throws on a missing context.

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
Symbol storage; interior frozen nodes inherit context from the marked region
above them. There is no generic attribution fallback.

## 3. import — the whole operation

```js
function importValue(value, errorContext) {
    if (errorContext === undefined) {
        // Fatal runtime configuration / compiler error — never a language Error:
        // a default here would mask the compiler bug and silently drop provenance.
        throw new Error("import requires an error context")
    }
    if (isPromise(value)) {
        return onResolve(value, settled => importValue(settled, errorContext))
    }
    return markImported(value, errorContext)  // primitives and Errors pass through
}
```

O(1). No walk, no validation, no mirror minting. The closure carries the context to
the settle point, and `markImported` routes it to META or the inline-mode side table,
so attribution is durable for every outcome — tracked, frozen, or re-imported. Promises
inside imported data are discovered lazily by whatever walk first touches them;
untouched ones are never resolved in place — external objects the program merely
holds are never mutated.

## 4. Marker propagation — the invariant

**Every language-reachable entry point into imported data carries the marker.**
Maintained at four sites, mirroring how SHARED propagates, with one deliberate
difference: provenance is about origin, not aliasing, so it propagates even where
sharing does not.

1. **Extraction (`lookupPath`)** — the walk threads the inherited context
   (`nodeImportContext` per level); an escaping value from inside an imported region
   is marked **even when `sharedOwnership === false`** (an ownership-transferred
   external branch is still external). `markImported` sets shared too, so the
   marking calls collapse to:

   ```js
   if (importContext !== undefined) markImported(value, importContext)
   else if (sharedOwnership) markShared(value)
   ```

2. **COW (`shallowCopy`)** — a copy of an imported node marks **all** reused tracked
   children with the context, including the path-key child (unlike shared marking:
   imported data must COW regardless, so the owned-path-key optimization does not
   apply to it). The copy itself is language-owned and unmarked; provenance lives on
   the reused content.

3. **Settle boundaries (mirrors)** — a mirror created inside an imported region
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

4. **Language integration (issues.md item 9)** — the compiler routes external values
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
reintroducing eager import scans.

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
  (`refIndexBranch` from normalize/hasError), already-ref-indexed subtrees may be
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
function refIndexBranch(value) {
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
pass: `commitRefIndex` already returns `[promiseCount, errorCount]`, so the write
path takes the new totals from the commit's return value instead of calling
`getRefCounts` on the value it just committed.

Failures surface by operation semantics, with attribution: ref-indexed write →
Error committed at the key; `normalize` → returns the Error; `hasError` → true.
`getRefCounts` keeps its throw — inside a counted region everything was validated,
so an Error there is a kernel bug.

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
  mirror-free — `onResolve(value, v => lookupValue(v, index, ctx))`. No advance is
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
| `import(value, errorContext)` | mark-only, O(1); derived promise marks the settled value |
| `lookupPath` | threads importContext; marks extraction even for `sharedOwnership=false`; mirror-free reads through frozen holders |
| `walkMutationPath` | re-derives importContext at each reached node; passes it to COW and attributed mutation errors |
| `shallowCopy` | preserves own enumerable `__proto__` as data before plain assignment; marks all reused tracked children with context; forked mirrors capture the COW walk's context; raw-seeded forks for frozen sources do the same |
| mirrors | writeback captures import context at mirror creation and marks settled value; `getOrCreatePromiseMirror(node, key, promise, importContext)` is used by walks and ref-indexing |
| `setProperty` | throws before own non-enumerable keys on the object being written; writes through plain assignment |
| `refSetProperty` | `validateCountable(value, parent)` before commit; Error committed at key |
| `refIndexBranch` | `validateCountable(value, undefined)` before commit; frozen roots validated, no counters/mirrors |
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
   and frozen-pure; escape boundaries deliberately do not validate, because escapes
   are the most frequent boundary in the language and eager cost there is exactly
   what this design removes.
2. Untouched promises inside imported data are never resolved in place; external
   objects the program only holds are never mutated by the runtime.
3. `__proto__` is forbidden as a language key: lookup treats it as missing,
   mutations throw, COW preserves own enumerable data keys without prototype
   mutation, and imported own enumerable keys reject at counting time.
4. Own non-enumerable properties are outside the language graph: lookup treats
   them as missing; owned mutations through them throw, while shared/imported
   branches COW first and shadow them as missing.
5. Frozen objects containing promises are readable and COW-able; only
   normalize/hasError reject them.
6. Reading through imported data marks provenance even on `sharedOwnership=false`
   lookups (shared marking itself is unchanged).

## 10. Test matrix

- `import` is O(1) and metadata-free beyond the root mark: cyclic import succeeds;
  no child META appears in the structure; untouched imported promises stay
  unresolved in place.
- `import(value)` without a context throws synchronously (fatal, not a language
  Error); the value receives no marks.
- Attribution durability for non-extensible values: a frozen direct import and a
  promise resolving to a frozen object both keep their errorContext (META in
  WeakMap mode, side table in inline mode), and a later counting rejection names
  the import site.
- Attribution: `refIndexBranch` on a cyclic/frozen-violating imported branch returns
  an Error containing the errorContext; ref-indexed write of an invalid imported
  value commits an Error at the key with context; context survives extraction, COW,
  and settle boundaries (deep chains: import → lookup sub-branch → COW → writeback →
  normalize-era validation still names the original import site).
- Propagation: extraction marks with `sharedOwnership=false`; COW marks reused
  children including the path key; fork mirrors inherit flavor; discovery inside an
  imported region marks resolved values imported+shared before consumers observe
  them (FIFO test).
- Back-edge: imported promise resolving to (a value containing) the live target
  under a ref-indexed parent → Error at the key with context, `verifyRefCounts`
  passes; same under a non-ref-indexed parent → cycle floats, walks terminate,
  later `refIndexBranch` rejects with context.
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
