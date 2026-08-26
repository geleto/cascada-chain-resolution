# Outbound export

**Status:** Implemented.

Export is the single outbound graph boundary. It prepares an ordered batch of host-call inputs or one script result with the same identity-aware copier.

## Copying

One export operation uses one visited set and one source-to-output identity map. It therefore preserves aliases and cycles, including aliases shared by separate argument positions.

The copier:

- resolves every reached logical Promise through its captured property version;
- copies managed records, Arrays, and class instances;
- preserves Array length, holes, indexed keys, own-key order, enumerable `__proto__`, and admitted prototypes;
- creates class copies without invoking constructors;
- keeps Functions and external identities exact; and
- emits no ArrayView, Promise mirror, metadata, counter, or other runtime representation.

Each batch root retains its own result position. Wrapping the roots in an ordinary object or Array would incorrectly turn a top-level input Error into nested host data.

## Errors

The same walk has two concrete policies:

- Every root consumes every distinct Error reached beneath it. One is returned unchanged; several produce `export: branch contains errors`, whose `.errors` contains those identities. Order within one graph is not semantic.
- A batch export combines failed roots in root order without flattening their `.errors` payloads. Any Error prevents host invocation or assignment. No Error is exported.

An Error discards partial output but does not stop the scan: pending captured branches may reveal other Errors. Export never starts a second `getErrors` operation.

## Promise ordering

Export traverses every available placement synchronously. A pending placement is captured through its exact Promise mirror. Its FIFO continuation traverses each newly revealed branch synchronously once before returning.

The operation retains output copies, its identity tables, and captured property versions. It does not lease or reread managed source identities. Later managed mutation may therefore proceed normally without changing the captured output.

Export captures only the selected path and the Promise frontier recursively exposed from it. It does not wait for unrelated graph Promises or build a refcount index. Rejected data Promises become ordinary Error values before the common Error rule is applied.

## Output lifetime

The output lifetime is export's application of the common operation-work lifetime. Fatal failure or closure by the owning operation closes it and releases partial copies and identity maps. An already-registered property continuation still completes its mirror and version settlement, then performs no export allocation, source reflection, or publication.

The result is synchronous when its captured frontier is ready. Otherwise one operation Promise fulfills with the completed copy or language Error. Unexpected internal readiness failure remains fatal.

## Ownership

Export adds no owner or shared mark to its source. This relies on ordinary ownership rules: another valid Cascada owner marks managed data shared, and later mutation uses COW. Application code must not mutate data after passing it to Cascada. Exact external state remains governed by its own ordering and mutation authority; export grants none.

`src/export.js` owns `exportValue`, `exportManyValues`, Promise continuation, copying, Error collection, and output closure. Observation and invocation code call those two shapes directly.
