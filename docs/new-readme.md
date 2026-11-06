# Draft language introduction

This incomplete editorial draft is not the kernel API contract. See the current
[README](../README.md) and [runtime contract](runtime-spec.md).

CascadaScript is a scripting language with intentionally simple syntax that will be instantly familiar to any developer. It integrates into JavaScript and TypeScript programs to orchestrate async dataflows (examples...) instead of using the native async/promise/await functionality.

What makes it special is how it runs under the hood: at any time all independent operations run concurrently, while all dependent operations wait for their inputs. This massively concurrent model is completely transparent to the developer - the runtime guarantees that the results will be identical to sequential execution. Any ... any ... any

The `!` operator marks mutation. Managed data uses copy-on-write and transition gates. External state cannot be copied, so Cascada orders access on its exact host identity:

```javascript
apis.db!.write(1)
return apis.db.read()
```

The compiler gives each context Chain a finite tree of static mutation-access prefixes. Initial context import follows only those named occurrences and registers selected external identities; it does not search managed subtrees. Assignment and deletion contribute their containing path. The read waits for conflicting earlier native work. Storing an external identity does not count as using it. Once registered, native access requires the canonical location and static source authority; metadata queries and repair have their own ordering rules.

There are two types of data in Cascada:
1. External state retains exact host identity. Ordered native access may inspect it, while graph traversal treats it as opaque. Mutation requires its registered canonical location and declared authority.
2. Managed state exposes its complete state through graph properties, so Cascada can resolve, copy, and isolate it.

External methods may mutate deeply nested host state. Cascada does not scan external objects for hidden aliases, so independently accessed external roots must not share mutable state.
