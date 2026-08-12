# Data Classes

## Status

Implemented. Registered JavaScript data-class instances participate in the language graph and retain their prototype across copy-on-write. Unregistered classes and native internal-slot objects are opaque leaves.

## Admitted values

The runtime records a fixed type when an available identity first enters Cascada. Arrays, plain objects, null-prototype records, registered data-class instances, and the internal `ArrayView` are traversable. Objects and registered instances expose own enumerable string keys. Arrays expose canonical indexes plus `length`; other string properties are not Array data.

Other objects, including `Date`, `Map`, `Set`, RegExp, typed arrays, and unregistered class instances, remain opaque values. Their metadata records identity facts such as import, sharing, and leases, but the runtime does not traverse, index, or copy their state. They may be assigned, returned, and exported, but a path cannot enter them and `run` cannot yet use them as receivers.

An Error is admitted terminal data. A Promise is resolved at its captured property version, and its available result is admitted instead.

## Registration

The package exports `registerDataClass`. Registration stores the class definition on the constructor's exact prototype in the same external metadata map used for admitted identities, without modifying the prototype:

```js
registerDataClass(Vec2)
```

Registration is permanent, must happen before instances enter Cascada, and is not inherited; each participating subclass must be registered separately. It asserts that every state value needed by supported behavior is stored in own enumerable string-keyed data properties. A copied instance normalizes those properties to ordinary enumerable writable configurable data properties.

Registration requires a callable constructor with an identity prototype. An invalid definition is a fatal host-contract failure.

The contract does not support required private fields, accessors, non-enumerable or Symbol-keyed state, closure state, hidden shared storage, or native internal slots. Registration is trusted; the runtime does not attempt to detect a false assertion. A callable `then` still makes the value a Promise.

No standard internal-slot class is registered automatically. Such types require dedicated support rather than `registerDataClass`.

## Copy-on-write

A copied registered instance is created from the prototype stored by its admitted class definition:

```js
Object.create(definition.prototype)
```

The existing property pipeline then copies its language properties, including ownership, Promise mirrors, cycle placement, and refcounts. Constructors do not run, metadata and descriptors are not copied, and inherited methods remain available.

Arrays, including cross-realm Arrays and subclasses, use the Array path and normalize to local ordinary Arrays. Plain objects normalize to local plain objects, while null-prototype records retain `null`.

## Methods and export

`run` may invoke a trusted read-only method on a registered instance. Mutating class methods remain unsupported.

Registered-class instances export as plain data without prototypes, methods, registration, or metadata. Opaque values export unchanged as identity leaves.
