# Outbound export

**Status:** Implemented.

Export is the single outbound graph boundary. It prepares an ordered batch of host-call inputs, one script result, or an internal host snapshot such as Array comparator input with the same identity-aware copier.

## Copying

One export operation uses one visited set, one source-to-output identity map, and one Error accumulator across the entire batch. Shared inspection preserves aliases and cycles across argument positions. Required root positions remain ordered; semantic Error membership has no separate per-root domain.

The copier:

- resolves every reached logical Promise through its captured property version;
- copies managed records, Arrays, and class instances;
- preserves Array length, holes, indexed keys, own-key order, enumerable `__proto__`, and admitted prototypes;
- creates class copies without invoking constructors;
- keeps Functions and external identities exact; and
- emits no ArrayView, Promise mirror, metadata, counter, or other runtime representation.

Every successful output follows the native `then` contract in [`data-limitations.md`](data-limitations.md). Exact Functions and external leaves must have a stable native lookup that safely yields a non-callable value from their first use onward; ready and pending export both preserve those exact identities. Managed producers validate their native lookup surface before publication. Export copies only language placements and preserves admitted prototypes; it does not copy hidden properties or add an exact-value probe or result wrapper.

Each successful batch root retains its own result position. Any reached Error prevents the whole host call after all required roots and nested branches finish collection.

## Errors

The walk collects every contextual Error reached beneath each root. One
semantic failure is preserved. Several produce a `CompoundPoisonError`; one final combination
flattens nested compounds and deduplicates by raw cause, source-context identity,
and kind, sharing the rule used by `getErrors`. Error order and representative
wrapper/source are unspecified; successful batch-root positions remain ordered. Any
Error prevents host invocation or assignment. No Error is exported.

An Error discards partial output but does not stop the scan: pending captured branches may reveal other Errors. Capture candidate keys and validate each placement descriptor before consuming values. A descriptor failure contributes its Error while other known keys remain required; a key-list failure ends only the undiscoverable interior. The same rule applies to records, Arrays, and bounded ArrayViews, whose candidate walk stays inside the selected range. Export never starts a second `getErrors` operation.

## Promise ordering

Export traverses every available placement synchronously. A pending placement is captured through its exact Promise mirror. Its FIFO continuation traverses each newly revealed branch synchronously once before returning.

The operation retains output copies, its identity tables, and captured property versions. It does not lease or reread managed source identities. Later managed mutation may therefore proceed normally without changing the captured output.

Export captures only the selected path and the Promise frontier recursively exposed from it. It does not wait for unrelated graph Promises or build a refcount index. A rejected data Promise is already contextualized by the boundary that introduced it; export preserves that occurrence.

## Output lifetime

Export operation work uses its containing operation's owner, or its own owner when export is standalone. A nested export receives only that owner, whose operation context is therefore authoritative. Export output has a separate resource lifetime: handing completed copies to the caller or discarding them releases output-only copies and identity maps without closing a containing operation. Export runs each possible-Promise branch first and derives pending lifetime from the normalized aggregate result, not from an input pre-scan or output backwrite. A pending nested export registers its release with the owner and unregisters on completion, so owner closure releases partial output even when an input never settles. A language Error discards output while the required Error scan continues. After required shared settlement, local owner closure in a live execution stops later export traversal. If the execution is fatal, a resumed export returns at the common execution check before settlement or traversal.

In a live execution, an already-registered property continuation still completes its mirror and version settlement, then performs no export allocation, source reflection, or publication after local operation closure. In a fatal execution it performs neither settlement nor export work.

The result is synchronous when every consumed frontier transition returns directly, including sync-first custom thenables. Otherwise one operation Promise fulfills with the completed copy or rejects with the final language Error. Export reflection failures use the export operation's source and kind; unexpected internal readiness failure becomes a fatal `FatalError` at that operation.

## Ownership

Export adds no owner or shared mark to its source. This relies on ordinary ownership rules: another valid Cascada owner marks managed data shared, and later mutation uses COW. Application code must not mutate data after passing it to Cascada. Exact external state remains governed by its own ordering and mutation authority; export grants none.

`src/export.js` owns `exportValue`, `exportManyValues`, copying, Error collection, and output release. `src/internal-step.js` owns complete root readiness and guarded continuation, while `src/operation-lifecycle.js` owns operation closure and releases; observation and invocation code call the two export shapes directly.
