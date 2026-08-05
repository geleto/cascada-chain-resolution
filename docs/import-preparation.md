# Imported data

`import(value, errorContext)` is the boundary for external data. Imported data
is borrowed: Cascada never changes its language properties or adds metadata to
the host object.

## Identity and ownership

One token stores the import's attribution:

```js
{ errorContext }
```

Every newly reached external identity directly references that token and is
marked shared. The token belongs to identities, not paths: containment neither
imports a runtime-owned identity nor declassifies an imported one. A shallow
copy-on-write copy has no token and is runtime-owned.

Imported metadata always lives in the WeakMap. Directly importing an identity
that already has inline runtime metadata moves that same record into the
WeakMap before returning.

## Synchronous admission

Import walks currently available language properties immediately. It:

- classifies previously unseen external identities;
- marks repeated identities shared; and
- installs the first resolver for each newly reached Promise property.

An identity that already has runtime metadata is an existing runtime-owned
island. It remains runtime-owned and shared. Import discovers Promise
placements in that island so their existing property versions continue through
the ordinary mirror pipeline.

Import does not build subtree counters or classify cycles. Any later
ref-indexing accepts the raw graph and creates its own acyclic projection; see
[`cycles-as-data.md`](cycles-as-data.md).

## Promise properties

The first resolver for an imported Promise property captures its import token
in its registration closure. At settlement it:

1. converts a rejection to a language Error;
2. classifies newly exposed external identities; and
3. publishes the logical value synchronously.

The external property remains the original Promise. Its mirror stores the
logical result in `resolvedValue`. If the property version was already
replaced, the result belongs only to that mirror's `detachedValue`.

The mirror stores no import token. Later operations use the same canonical
Promise only as a FIFO readiness signal and read the latest live or detached
mirror state after earlier resolvers finish.

Directly importing a runtime-owned container advances each existing pending
property to a new imported mirror version at that program position. Earlier
operations retain the old version. Merely reaching a runtime-owned island
through another imported object reuses its existing mirrors and adds no
consumer.

A Promise root is admitted by one derived Promise. Its fulfillment classifies
the resolved root before exposing it; rejection follows the normal language
Error rule.

## Copy-on-write and attachment

Mutation copies every imported container on the path before writing. Reused
imported children keep their own import tokens; copied containers are owned.

If a copied path publishes data with pending Promises, its first copied root is
marked shared. This preserves the operation's issue-time world while those
Promise continuations remain able to use it. Promise settlement itself still
uses the ordinary mirror and property-transition rules.

Frozen, sealed, and writable imported objects have the same semantics. Their
only physical difference is which writes JavaScript would allow, but Cascada
does not attempt any of them.

## Language surface

Only own enumerable string keys participate. Canonical Array indexes are the
Array data surface. An own enumerable `__proto__` is ordinary data; missing
keys are defined as own properties so inherited setters never run.

## Module boundary

- `src/import.js` owns external identity classification and Promise-frontier
  discovery.
- `src/meta.js` owns import tokens and external metadata storage.
- `src/promise-mirrors.js` owns Promise-backed property versions.
- `src/property-transitions.js` applies settlement through ordinary logical
  publication.
