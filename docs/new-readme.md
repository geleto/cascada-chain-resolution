CascadaScript is a scripting language with intentionally simple syntax that will be instantly familiar to any developer. It integrates into JavaScript and TypeScript programs to orchestrate async dataflows (examples...) instead of using the native async/promise/await functionality.

What makes it special is how it runs under the hood: at any time all independent operations run concurrently, while all dependent operations wait for their inputs. This massively concurrent model is completely transparent to the developer - the runtime guarantees that the results will be identical to sequential execution. Any ... any ... any

The `!` operator marks mutation. Managed data uses ordinary managed mutation. On external context state, it also establishes ordering for the runtime path:

```javascript
apis.db!.write(1)
return apis.db.read()
```

The read waits for the write's Promise. Managed paths may contain asynchronous computed keys, while external mutation paths are written statically. A mutable external identity has one fixed context path for the execution and may be passed by reference while Cascada keeps that path entered. That path cannot be replaced or deleted; duplicated external identities are observation-only.

There are two types of data in Cascada:
1. External state is exact host state that Cascada cannot inspect. It is observation-only unless context initialization fixes it to one unique path used by external context `!` operations.
2. Managed state exposes its complete state through graph properties, so Cascada can resolve, copy, and isolate it.
