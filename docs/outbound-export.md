# Outbound export

**Status:** Implemented.

Export is the single outbound graph boundary. It prepares an ordered batch of host-call inputs, one script result, or an internal host snapshot such as Array comparator input with the same identity-aware copier.

## Copying

One export operation uses one visited set per root and one source-to-output identity map for the batch. Separate visited sets preserve each root's Error domain; the shared map preserves aliases and cycles across argument positions.

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

Export operation work uses its containing operation's owner, or its own owner when export is standalone. A nested export receives only that owner, whose operation context is therefore authoritative. Export output has a separate resource lifetime: handing completed copies to the caller or discarding them releases output-only copies and identity maps without closing a containing operation. A pending nested export registers that release with its owner and unregisters on completion, so owner closure releases partial output even when an input never settles. A language Error discards output while the required Error scan continues. Fatal failure or closure by the owning operation abandons later export traversal after shared settlement.

An already-registered property continuation still completes its mirror and version settlement, then performs no export allocation, source reflection, or publication after operation closure.

The result is synchronous when its captured frontier is ready. Otherwise one operation Promise fulfills with the completed copy or language Error. Unexpected internal readiness failure remains fatal.

## Ownership

Export adds no owner or shared mark to its source. This relies on ordinary ownership rules: another valid Cascada owner marks managed data shared, and later mutation uses COW. Application code must not mutate data after passing it to Cascada. Exact external state remains governed by its own ordering and mutation authority; export grants none.

`src/export.js` owns `exportValue`, `exportManyValues`, copying, Error collection, and output release. `src/operation-lifecycle.js` owns guarded continuation and operation closure; observation and invocation code call the two export shapes directly.
