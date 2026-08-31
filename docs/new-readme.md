CascadaScript is a scripting language with intentionally simple syntax that will be instantly familiar to any developer. It integrates into JavaScript and TypeScript programs to orchestrate async dataflows (examples...) instead of using the native async/promise/await functionality.

What makes it special is how it runs under the hood: at any time all independent operations run concurrently, while all dependent operations wait for their inputs. This massively concurrent model is completely transparent to the developer - the runtime guarantees that the results will be identical to sequential execution. Any ... any ... any

The `!` operator marks mutation. Managed data uses copy-on-write and transition gates. External state cannot be copied, so Cascada orders access on its exact host identity:

```javascript
apis.db!.write(1)
return apis.db.read()
```

The compiler gives each context Chain its possible external-mutation locations. Initial context import searches a `!` scope for external state, but an assignment or deletion checks only its containing path and never the old target. The read waits for the write's Promise. Storing an external identity does not count as using it. External mutation is allowed only when every actual use occurs through one recorded path of one context Chain; use outside that Chain or through another path makes access fail.

There are two types of data in Cascada:
1. External state is exact host state that Cascada cannot inspect. Mutation requires exclusive use through one context Chain path and fixes all later access to that location.
2. Managed state exposes its complete state through graph properties, so Cascada can resolve, copy, and isolate it.

External methods may mutate deeply nested host state. Cascada does not scan external objects for hidden aliases, so independently accessed external roots must not share mutable state.
