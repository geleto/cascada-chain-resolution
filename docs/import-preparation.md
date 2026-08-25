# Imported data

`import(value, errorContext)` is the inbound host-data boundary. Imported managed data is borrowed: Cascada stores metadata externally and never modifies its host representation.

## Admission walk

Each available synchronous segment uses one transactional identity walk:

1. Classify every newly reached identity from its declarations and defaults.
2. Traverse new managed records, Arrays, and class instances once while preserving aliases and cycles.
3. Stop at external identities, Functions, and Errors.
4. Capture each reached Promise placement without awaiting it.
5. Commit admission, origin, sharing, and Promise mirrors only after the complete segment validates.

The walk inspects only own enumerable string-keyed data properties. It neither invokes accessors nor inspects non-enumerables. Enumeration or descriptor failure returns a language Error and commits nothing from that synchronous segment.

An already admitted identity keeps its category and origin and is not rescanned. When importing it adds another owner, an admitted managed identity is marked shared. Import builds no refcount index.

## Promise boundaries

A direct Promise root returns one operation Promise. Fulfillment completes the same import before exposing its value; rejection remains a rejection.

A nested Promise belongs to its captured property version. Its fulfillment imports newly exposed data before publishing the logical value, while rejection publishes a language Error. Imported physical storage keeps the original Promise; the mirror stores its logical settlement without writeback. Runtime-owned Promise properties retain ordinary writeback.

## Ownership

New imported managed identities are marked imported and shared, so mutation copy-on-writes before changing them. Copies are runtime-owned; reused imported children keep their origin. Frozen, sealed, and writable imported managed objects therefore have the same logical behavior.

Application code must not mutate managed data after passing it to Cascada. External identities remain exact leaves and are observation-only until external-operation support supplies explicit authority.

## Modules

- `src/import.js` owns the public boundary and direct-Promise completion.
- `src/import-preparation.js` owns the transactional admission walk.
- `src/meta.js` owns declarations, admitted facts, and origin metadata.
- `src/property-versions.js` owns captured Promise placements and settlement publication.
