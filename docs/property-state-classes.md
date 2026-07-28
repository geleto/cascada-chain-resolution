# Property-State Classes

## Scope

This document defines implemented plan step 20: copy-on-write support for classes whose
complete Cascada-relevant state is already represented by Cascada's existing
language properties.

Step 20 supports:

- ordinary certified class instances;
- multiple inheritance levels that introduce additional instance fields;
- null-prototype records; and
- arrays through their existing path, normalized to local ordinary arrays.

It does not change the definition of language data. Language-visible state
remains own enumerable string-keyed properties. Array-subclass behavior, Map
entries, Set members, symbols, non-enumerable properties, prototypes, and
native internal slots do not become graph edges.

Deferred container and method-call ideas are recorded separately in
[`future/keyed-containers.md`](future/keyed-containers.md).

## Property-state contract

A supported instance keeps all state observed or mutated by Cascada, and all
state required by its supported prototype behavior, in own enumerable
string-keyed data properties.

For example:

```js
class Vec2 {
    constructor(x, y) {
        this.x = x
        this.y = y
    }

    length() {
        return Math.hypot(this.x, this.y)
    }
}

class FVec3 extends Vec2 {
    constructor(x, y, z) {
        super(x, y)
        this.z = z
        this.precision = "float"
    }

    volume() {
        return this.x * this.y * this.z
    }
}
```

A COW copy of an `FVec3` retains `FVec3.prototype`, remains an instance of
both `FVec3` and `Vec2`, and independently processes `x`, `y`, `z`, and
`precision` through the existing property pipeline.

The class accepts the kernel's normal descriptor normalization. Copied fields
become enumerable writable configurable data properties. A class whose
behavior depends on field writability, configurability, accessors, private
fields, or other hidden state is not a property-state class.

## Explicit certification

`src/mutations.js` exports a host-only Symbol named `PROPERTY_STATE_CLASS` for
internal language integration and tests. Step 20 does not add it to the
package-level `src/index.js` API; the final public surface is a later language
integration decision. The instance's exact custom prototype must contain its
own data descriptor whose key is that Symbol and whose value is `true`:

```js
Object.defineProperty(Vec2.prototype, PROPERTY_STATE_CLASS, {
    value: true,
})

Object.defineProperty(FVec3.prototype, PROPERTY_STATE_CLASS, {
    value: true,
})
```

Certification is not inherited. Every exact custom prototype certifies its own
complete representation, including fields or behavior introduced by that
class. The Symbol is outside the language-visible graph and is shared through
the prototype rather than copied into an instance.

The marker is a declaration, not a callback, constructor, factory, serializer,
or adapter. The kernel alone constructs and populates the COW copy.

Only an own marker data descriptor whose value is exactly `true` certifies the
prototype. A missing marker, accessor marker, or any other value is simply
uncertified and follows the expected unsupported-COW Error path. A certified
instance shape that violates the trusted contract is not promised proactive
detection; any unexpected throw it causes remains fatal.

Tests import `PROPERTY_STATE_CLASS` directly from `src/mutations.js`, ensuring
they use the same Symbol as COW classification without changing the package's
exact ESM export list.

## Supported and unsupported shapes

Supported class state consists only of own enumerable data properties.

The following are unsupported:

- JavaScript `#private` fields required by a method;
- own enumerable accessors;
- required non-enumerable or Symbol-keyed state;
- native internal slots without a kernel copy strategy;
- state captured only by a closure associated with the original identity;
- hidden shared mutable storage;
- proxies, which are outside the trusted property-state contract and need not
  be detected as a distinct kind;
- a callable `then` on the instance or its prototype chain; and
- an unmarked custom prototype.

Callable `then` remains unsupported because the kernel and JavaScript Promise
assimilation classify such a value as a Promise before class COW is considered.

Array subclasses are valid array data and normalize to ordinary arrays during
COW; their prototypes and methods are not preserved. Marking Map, Set, Date,
RegExp, typed-array, buffer, WeakMap, WeakSet, or similar non-array intrinsic
prototypes is false host certification. The runtime deliberately maintains no
built-in detector and may not discover the violation until native behavior is
used.

## Private COW shell factory

There is no independent runtime classification phase. One private
`createCopyShell` function in `mutations.js` embodies the complete decision
only when mutation requires COW:

```js
function createCopyShell(source) {
    const prototype = Object.getPrototypeOf(source)

    if (Array.isArray(source)) {
        return new Array(source.length)
    }

    if (prototype === null) return Object.create(null)
    if (isObjectPrototype(prototype)) return {}
    return Object.getOwnPropertyDescriptor(
        prototype,
        PROPERTY_STATE_CLASS,
    )?.value === true
        ? Object.create(prototype)
        : undefined
}
```

`isObjectPrototype` recognizes an intrinsic object prototype structurally: it
has a null prototype and an own constructor whose own `prototype` value points
back to it. This preserves existing support for cross-realm plain objects.
Every value accepted by `Array.isArray` uses a local ordinary `Array` shell, so
cross-realm arrays and subclasses require no further classification. No realm
registry or intrinsic type list is introduced.

Promises and Errors have already been excluded by the mutation walk before the
factory is called. Import preparation, lookup, Error queries, export, refcounts,
and Promise mirrors gain no class-specific path or metadata.

The inline certification check uses an own descriptor and never invokes a
marker getter. The host must not
mutate the instance's prototype chain or certification while an imported
identity remains live.

Reclassification on later COW is sufficient for this limited design: a
runtime-created copy has the same certified prototype, and no generalized
container-kind record is needed. Imported host mutation remains forbidden.

A missing marker, accessor marker, `false`, `undefined`, or any other non-true
value is the same expected unsupported shape.

### Detected and trusted violations

The runtime detects only facts required by shell selection:

- whether exact-prototype certification is exactly `true`;
- callable `then`, through the existing Promise classification; and
- reflection or proxy traps that throw.

Certification remains a trusted assertion for semantic facts reflection cannot
establish:

- whether a method requires a `#private` field;
- whether an own enumerable property is an accessor;
- whether behavior depends on non-enumerable or Symbol-keyed state;
- whether a closure carries identity-specific state;
- whether instances share hidden mutable storage; and
- whether an incorrectly marked native object requires internal slots.

The runtime does not attempt heuristics, internal-slot lists, or additional
scans for trusted facts. A host that falsely certifies one has violated the
contract, even if the failure becomes visible only when a getter or method is
later called.

## Copy construction

### Plain and null-prototype records

Plain objects from any realm retain the existing local `{}` shell.
Null-prototype records use:

```js
Object.create(null)
```

Both copy only own enumerable string keys through the existing loop.

### Certified class instances

A certified ordinary class uses:

```js
Object.create(Object.getPrototypeOf(source))
```

The shell begins with no own fields. Every `Object.keys(source)` property then
passes through the existing sanctioned unobservable write and all existing
per-property work:

- retained-child shared marking;
- imported-boundary propagation;
- Promise mirror forking at the copier's program position;
- cycle placement reconstruction;
- refcount reconstruction; and
- parent-edge registration.

No source metadata, descriptors, accessors, non-enumerable properties, or
symbols are copied.

Certified classes use the same `readLanguageProperty` call already used by
plain objects and arrays. No descriptor read, validation pass, snapshot,
container dispatch, or new helper is added to the property loop.

Certification is a trusted host assertion. If a certified accessor or other
hidden dependency behaves incorrectly, the host has violated the contract;
step 20 does not add machinery to discover or recover from it.

## Unsupported COW

An unsupported non-plain instance may continue to be observed under the
runtime's existing own-enumerable-property rules. Step 20 changes its mutation
behavior only when COW through that instance is required.

Instead of silently copying it into `{}`, the mutation produces an attributed
language Error at the owner/key placement by which traversal reached the
unsupported instance. If it is the mutation root, the Error replaces the root.
The requested descendant write is not attempted, and the external source
remains unchanged.

The mutation caller invokes `createCopyShell` before calling `shallowCopy`, so
this expected Error path creates no partial mirrors, counters, cuts, parent
edges, `attachmentPath` changes, or shared marks. If the factory returns no
shell, the caller returns a validation Error. The existing recursive mutation
walk installs it through the same return path already used by path-access
Errors:

- a nested caller uses `setProperty`;
- the root frame replaces `_state.value`; and
- a Promise-resumed frame uses `setMirrorValue`.

The existing inherited import boundary supplies attribution; no import-time
class metadata is required. Without an import boundary, the same unsupported
shape produces the same Error value without attribution.

Proxy trap behavior, unexpected reflection failures, and impossible kernel
postconditions are fatal rather than language Errors.

Host integrations that need Map or Set data should normalize it before import:

```js
const mapData = Object.fromEntries(map)
const setData = Object.fromEntries(
    [...set].map(key => [key, true]),
)
```

## Prototype methods

COW preserves prototype identity, so inherited and overridden methods remain
present and can be shown to function on the copied instance.

Step 20 does not add a general method-execution protocol. Direct opaque method
calls over tracked data are outside the kernel contract:

- a method that writes `this.x` bypasses COW and graph transitions;
- a method that reads a Promise-backed field sees the physical Promise instead
  of registering at its program position; and
- a returned tracked child can bypass normal ownership marking.

Tests may invoke known pure synchronous methods to verify that prototype
behavior survived copying. Language/compiler support for arbitrary method
calls, Promise-sensitive reads, mutators, or returned-value ownership is
deferred.

## Export

Export remains deliberately plain data:

- a class instance exports as a plain object;
- prototypes, methods, certification, and runtime metadata are omitted.

Existing export ordering, Promise-frontier, Error-set, alias, and cycle
contracts remain unchanged.

## Test matrix

Every test runs under inline-Symbol and WeakMap metadata modes.

### Classes and inheritance

- root and nested certified instances;
- ordinary top-level and sibling properties remain unchanged;
- at least three independently certified inheritance levels;
- new enumerable fields introduced at every level;
- inherited, overridden, and newly introduced pure methods after COW;
- `instanceof` at every level;
- aliases to the same class instance;
- self-cycles and cycles crossing ordinary/class nodes;
- Promise and Error fields;
- same-Promise reassignment and COW mirror divergence;
- enumerable `__proto__`, `constructor`, and method-name fields;
- external source isolation; and
- repeated COW through a runtime-created certified copy.

### Records and arrays

- null-prototype preservation;
- unchanged local and cross-realm plain-object behavior;
- unchanged local and cross-realm sparse-array behavior; and
- ordinary-array normalization for marked and unmarked array subclasses.

### Unsupported and failure cases

- tests use the exact `PROPERTY_STATE_CLASS` exported by `src/mutations.js`;
- an unmarked custom class;
- trusted-contract examples using a private field, own accessor,
  descriptor-dependent behavior, or required non-enumerable/Symbol state,
  without requiring proactive runtime detection;
- callable own and inherited `then`;
- proxy traps and throwing reflection are fatal without proxy detection;
- falsely marked internal-slot built-ins are documented contract violations,
  not a detected type list;
- prototype or certification mutation after import;
- exact attributed Error placement for nested, root, and Promise-resumed COW;
- no partial mirrors, counters, cuts, parent edges, or shared marks on the
  expected unsupported-shell Error path;
- missing, accessor, false, undefined, and other non-true marker shapes all
  following the expected attributed Error path;
- fatal reporting for detected unexpected throws without conversion to
  language Error;
- false trusted assertions are never promised proactive detection; and
- the complete existing Promise, Error, alias, cycle, refcount, and verifier
  interactions rather than a reduced combinatorial test set.

## Documentation consistency

The runtime specification and README say that COW
preserves explicitly certified non-array property-state class prototypes. They
must continue to state that all arrays normalize to ordinary arrays during
COW, language graph edges are only own
enumerable string-keyed properties, and export is plain data.
