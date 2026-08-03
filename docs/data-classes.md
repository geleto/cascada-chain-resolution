# Data Classes

## Status

Implemented. Registered JavaScript data-class instances participate in the language graph and retain their prototype across copy-on-write. Unregistered classes and native internal-slot objects are opaque leaves.

## Tracked values

The runtime tracks Arrays, plain objects, null-prototype records, registered data-class instances, and the internal `ArrayView`. Objects and registered instances expose own enumerable string keys. Arrays expose canonical indexes plus `length`; other string properties are not Array data.

Other objects, including `Date`, `Map`, `Set`, RegExp, typed arrays, and unregistered class instances, remain opaque values. The runtime preserves their identity but does not traverse, index, import, export-copy, or attach metadata to them. They may be assigned, returned, and exported, but a path cannot enter them and `run` cannot use them as receivers. External mutation of an opaque value is outside Cascada's guarantees.

Promises and Errors retain their separate runtime meanings and are not opaque objects.

## Registration

The package exports `registerDataClass`. Registration adds the constructor's exact prototype to a private `WeakSet` without modifying it:

```js
registerDataClass(Vec2)
```

Registration is permanent, must happen before instances enter Cascada, and is not inherited; each participating subclass must be registered separately. It asserts that every state value needed by supported behavior is stored in own enumerable string-keyed data properties. A copied instance normalizes those properties to ordinary enumerable writable configurable data properties.

The contract does not support required private fields, accessors, non-enumerable or Symbol-keyed state, closure state, hidden shared storage, or native internal slots. Registration is trusted; the runtime does not attempt to detect a false assertion. A callable `then` still makes the value a Promise.

No standard internal-slot class is registered automatically. Such types require dedicated support rather than `registerDataClass`.

## Copy-on-write

A copied registered instance is created with:

```js
Object.create(Object.getPrototypeOf(source))
```

The existing property pipeline then copies its language properties, including ownership, Promise mirrors, cycle placement, and refcounts. Constructors do not run, metadata and descriptors are not copied, and inherited methods remain available.

Arrays, including cross-realm Arrays and subclasses, use the Array path and normalize to local ordinary Arrays. Plain objects normalize to local plain objects, while null-prototype records retain `null`.

## Methods and export

`run` may invoke a trusted read-only method on a registered instance. Mutating class methods remain unsupported.

Tracked class instances export as plain data without prototypes, methods, registration, or metadata. Opaque values export unchanged as identity leaves.
