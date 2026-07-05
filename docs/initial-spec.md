I am implementing a programming language that uses copy-on-write for variable assignment and modification.
We support objects and arrays, the language is compiled into JavaScript.
But whenever possible we shall still reuse the structure.
When modifying only a child property - we shallow copies the object at each level along the modified path, iterating deeper only along the path and finally setting the changed property.


// Illustrative code to show shall-on-each-path-level copying
function simpleDeepAssign(root, segments, value) {
  // No segments left: replace the whole value.
  if (segments.length === 0) {
    return value;
  }

  const [head, ...tail] = segments;

  if (root === undefined || root === null) {
    throw new Error(`Cannot access property '${head}' of undefined or null`);
  }

  const newChild = deepAssign(root[head], tail, value);

  if (Array.isArray(root)) {
    const newRoot = [...root];
    newRoot[head] = newChild;
    return newRoot;
  }
  return { ...root, [head]: newChild };
}

We need to be selective when mutating the object. We use copy-on-write, but only when the object has moved outside of the variable (assigned to other vars, used as arguments, etc…).
var a = { x:1, y:2 }
a.x = 2 // no copy on write
var b = a;
a.x = 1 // this requires copy on write to avoid changing b

The same principle works selectively on branches

var location = { pos: {x:1,y:2}, delta = {x:3, y:4} }
var pos = location.pos
location.pos.x = 2 // copy on write of pos to avoid changing it
location.delta.x = 5 // no copy on write

Objects imported from outside calls also need not be modified, so copy on write is used on them too.

Additionally, promises are handled transparently. If a property is set to a promise, once that promise is resolved, it is replaced by the resolved value automatically. If the value rejects, it is replaced by the Error object. Also deepAssign can receive an Error object as value and it has to be properly referenced(see CLEAN). Any operation or walk that encounters a settled-but-unreplaced promise replaces it in place (with CLEAN propagation), and registers writeback for pending unregistered ones it discovers.

We have these helpers:
import(obj, rescan=true) - for marking outside objects immutable. If rescan is true - walks obj to find promises. Errors shall not be counted - this is an internal mechanism to the language and an object that exits the language is collapsed to a single Error. Works with promises - it is marked as immutable after resolve. External objects are not expected to be mutated by outside code.
deepAssign(root, segments, value) - for changing the whole object or any path value. Any branch/property with the non-mutable marking will be copied-on-write. Importing objects with promises is not recommended as the imported object will have the promise rewritten to the resolved value. For a data chain, missing intermediate path segments and properties(last in path) are created. Path segments are objects, properties are assigned.
deepDelete(root, segments) - for deleting a path. Can not be used on arrays. It is of course possible to use transformation that creates a new array without the element, but this is done outside the variables.
lookup(root, segments) - returns the value. The return is always marked as immutable, because of this even root access has to go through lookup.
normalize(full) - marks the whole thing as copy-on-write/immutable, waits for all promises to resolve. It leaves the copy-on-write/immutable marks through the object. Set full=true to perform complete copy with no marks left ( Another solution is for the marks to be in a global WeakMap and not part of the object ). If there is any Error in the object - the return is a single Error (just a single error indicating multiple errors - this is a sandbox test implementation). It repeats scanning/awaiting until the reachable branch contains no pending promises. Returns a promise that resolves to a complete object with no promises/errors in it, or an Error object if any Error or rejecting promise was still left.
hasError(root, segments) - whether the property is an error, or there was an error along the path. Resolves the path(returns true if that fails), then checks the reached branch for errors (resolving any promises, etc…)

All of these except hasError and normalize run immediately, we do not await one operation before running the next. One thing to keep in mind - the first to await will be the first to continue execution, so operations will run in order despite awaiting the same promises, there will be no race conditions. All operations (the actual calls: deepAssingn, lookup, normalize/etc…) to the same root shall happen sequentially - this is enforced by the implementer. Sequentially means issued and committed in program order, not awaited to completion: each operation's synchronous prefix runs to the end - committing its synchronous changes and registering its continuations at its own program position - before the next operation is issued. Suspended remainders complete later, in that same order per promise (FIFO). No operation is ever awaited before the next one is issued - that would serialize the program and make the FIFO machinery pointless.

Immutability is evaluated only from the point of the target language. Promises and resolved values are interchangeable (promises are implicitly resolved), none of the markings are visible, etc… We may use weakmap, but using a Symbol property for all metadata is probably the simplest approach. This Symbol property is ignored by the language.

A promise exposed through lookup/import carries the same IMMUTABLE obligation as a directly returned object/array. If it resolves to an object/array, the resolved value is marked IMMUTABLE before consumers can observe it.

Shallow Copy - { ...root, [head]: newChild } re-shares every key except head. As the object that requires such copying is immutable, the old copied properties must be marked as immutable, while the new property is not immutable. Another, simpler approach is to deep-freeze the whole copied branch. And a third approach is to add both IMMUTABLE and NOT_IMMUTABLE markings, and using not-immutable for the new along-the-path properties. The copy never inherits the source's shadow object (see Value resolve) - it starts with its own, fresh one. Every copied edge that holds a promise is forked eagerly at copy time (see Value resolve - the Fork birth point); the scan is O(width of the node), the same order of cost as the copy itself.

Marking Immutable (requiring copy-on-write) - All branches that are immutable are marked at the root. The mechanisms to mark an object immutable are 2 - import and lookup. Imported data need not be modified and this is all import does - mark. When we have a lookup at a sub-branch - it has to be marked as immutable too. So nested immutables are fine. An immutable mark logically also applies to children, but they need not carry it. All operations that share/access a whole existing object or branch - assignment/pass/return - they all must use lookup.

Value resolve - each node carries a hidden shadow object (under a Symbol), created for every key that was assigned a promise, storing a {promise, current} record: the promise that was last placed there, and the newest version of its resolved value. `current` is changed by each operation that mutates it, in operation order, so each op's change is applied on top of the previous `current` rather than on the original resolved value. When a promise resolves - the writeback first marks the resolved object/array immutable, before any consumer can observe it: this discharges the IMMUTABLE obligation universally, and it is what forces every chain advance to copy (V → V′ → V″) and keeps two edges holding the same promise from corrupting each other through the shared resolved value. Then it is written back into its property, but only if its record is still the one the shadow object holds for that key and the property in the node still holds the promise unchanged. If a later op has since reassigned the key (even to the same promise) - the {promise, current} record is created anew. Even if not written to the node property - we keep {promise, current} alive privately - for reads that captured it - without touching the node property. All required accessible promises must start resolving immediately: we use .then and continue walking rather than await + enter, leaving other immediately accessible promises to resolve in parallel (and yet in operation order as guaranteed by JS).

A record is born at exactly three points, and where its starting `current` comes from differs:

- Placement: a promise is assigned to a property (deepAssign value, literal initialization). A fresh record is always created, even if the same promise instance was already at this edge - two placements are divergent worlds and must not share a chain. The writeback continuation is registered immediately at placement, before any operation can register on that promise for this edge, so the writeback is always the first responder and `current` starts as the raw resolved value.

- Discovery: a walk or operation reaches a promise edge that has no record (imported data, raw literals - any orphan). The record is created and its writeback registered at the discovering operation's program position; `current` starts as the raw resolved value.

- Fork: a copy-on-write shallow copy duplicates an edge that holds a promise. The copy's record must be created eagerly, at copy time - never minted lazily by a later walk. A lazily minted record would seed `current` from the raw resolved value, silently losing every mutation made by operations issued before the copy. At copy time, for each copied edge that holds a promise: ensure the source node has a record (Discovery, if it is an orphan), then create the copy's record and register its initializer immediately, at the copier's program position. This initializer never reads the raw resolved value - it reads the source record's `current` at its own FIFO slot, marks that value immutable (it is now shared by both worlds), and uses it as the copy's starting `current`, mirroring it into the copy's property only if the copy's edge still holds the promise unchanged. Because the initializer is registered at the copier's program position, it observes exactly the advances of operations issued before the copy and none issued after - the two worlds diverge at precisely the copier's place in program order, uniformly for pending and settled-but-unreplaced promises. After the fork the chains are independent: operations traversing the copy advance the copy's record, operations traversing the old node advance the source record, and the immutable mark on the captured value forces the first advance on either side to copy. Chain advances themselves go through the same shallow copy, so a resolved value that contains nested promise edges is forked by this same rule automatically.

deepAssign - If it reaches a promise in the intermediate path it resolves it and continues through the record's `current` (see Value resolve), COWing that value and advancing the chain. If an intermediate path is missing - create it (a blank {}). Continue through the path (resolving any promises along the way), assigning the value when the path end is reached. Because it is the first to await the promise, it is the first to resume and modify. When it reaches an object marked immutable along the path it copies it (the COW approach above). deepAssign into an error node is a no-op. It installs the copied spine top-down as it descends, so the new root identity is decided synchronously and rebinding is synchronous; the variable must be associated with the returned root before the next command is issued. The return may be a synchronous new or old root, or a promise for the new root only when the root itself is pending, or an Error when the root is already an Error. A rejecting return value shall be resolved as Error.

lookup - returns the value it reaches. If that value is a promise, or if a promise lies along the path, it returns a promise that resolves to the value once reachable - continuing through `current` if the path was mutated during resolution (see Value resolve), never the raw resolved value. The returned promise is not awaited by lookup itself; values resolve only at the point of consumption. Marks the return immutable if it is an array or object; if the return is a promise, it ensures the resolved value is marked immutable. Return semantics otherwise as deepAssign. Any Error or rejecting promise along the path results in an Error return.

deepDelete - resolves the intermediate path segments to reach the target (a segment may be a promise, continued through `current` per Value resolve, not awaited), then deletes it, clearing the key's shadow entry so no later writeback re-mirrors it. COWs immutable branches along the way (the COW approach above). Objects only. Any Error along the path is a no-op. Returns the new root, with the same synchronous/pending/Error semantics as deepAssign.

Optimizations:
RefCounting is possible (we can not have cycles and shared objects can flow their ref counts to multiple parents), so we shall decide if we shall switch to ref-counting or continue to use CLEAN.

CLEAN flag - without optimizations - hasError and normalize require walking the whole tree. This can be optimized by marking nodes that we know have no promises and errors as CLEAN. CLEAN proves absence of errors/promises but its lack does not guarantee non-cleanness. It can be only used to skip branches marked as clean for checking for errors and promises.
.

Then the tree walks can skip those branches. For this to work, each object/array maintains:
- trackedKeyCount
- cleanCount
- parents

Primitive values are ignored because they are always clean. Promises and errors are tracked and unclean. Objects/arrays are tracked and clean iff cleanCount === trackedKeyCount.

parents contains the known parent/key edges discovered by previous walks. It may be incomplete for unvisited branches, a stale already-resolved promise in an unvisited branch simply makes that branch not-clean until a later walk reaches it. Therefore parent propagation is only an optimization for known-clean/visited structure used for CLEAN.
Each visited node adds its parent to its own `parents` if missing. When parent is added - clean is propagated if present through it.

When we mark a node clean - it checks the parent and whether the child is still there, increasing cleanCount and if parent is now clean, continues up the parent hierarchy.

How this affects the operations:
deepAssign - if clean!=newClean for replaced property - propagate the state to the parent(s). Updates the parents set. If we have a new property - evaluate clean!=newClean for the parent and propagate if needed.
deepDelete - trackedKeyCount–, if was clean, cleanCount–, otherwise if now clean - propagate. Updates the parents set.
lookup - if a promise is resolved to a clean value - propagate
import - not clean
normalize - updates the clean state of the branch depending if there were any errors, if clean - propagate
isError - similar to normalize

We need node.makeClean(true/false) that takes care of the propagation. Clean stops at the first non-clean node,
Initializing trackedKeyCount - use a getter for trackedKeyCount and cleanCount that initializes these, cleanCount starts with 0 and trackedKeyCount is properly calculated

Correctness:

Cycles: It is impossible to have cycles.
a.property.subproperty = a
The moment we lookup `a` it becomes immutable. The moment we modify subproperty - `a` becomes copied (simpleDeepAssign), thus it is a new object, no cycle. Import values will not be allowed to have cyclic data (either by requirement or actively validated on import)

Object reuse: Any object that is reused - the only way this can happen is via lookup, which marks the object as IMMUTABLE. An assignment and initialzier can target only one variable, so that the ownership is clear. var x = {a:1, b:2} - is owned by x and needs no immutable mark. But var y = x will make the object immutable for both x and y. Any promise that resolves to the same data from multiple instances of that promise is guaranteed to get immutable-marked data, through the same mechanism.

Race conditions: with deepAssign and deepDelete, it may look as if we are opening the possibility for race conditions. While one operation awaits a promise that resolves some data, a subsequent operation may modify the data - or commit synchronously and overtake the suspended one entirely. Why neither can corrupt anything or diverge from sequential semantics:

Program order = FIFO order. Operations are issued in program order and register their continuations at their own program position; JS runs continuations on one promise in registration order. So all consumers of one placement resume in program order, each advancing the record's `current` on top of the previous operation's version (V → V′ → V″). Immediate resolution of all accessible promises is required for this to hold (use .then and keep walking, never await + enter).

The resolved value is marked immutable by the writeback before any consumer observes it. Together with escape marking (lookup) this is what forces every advance to copy instead of mutating a value that another consumer, another edge holding the same promise, or a forked world still references.

Suspended reads are immune to overtaking writes: a suspended lookup continues through the record's private `current`, never the live property. A later operation that synchronously reassigns or deletes the edge (clearPlacement + assignment) is invisible to it - the read resolves to the chain value as of its own program position, exactly what sequential execution would have returned.

Suspended writes are fenced by the two-part mirror guard: a resumed write mirrors into the live tree only if its record still owns the key (map[key] === rec - revoked by a later placement or clearPlacement) and the property still holds the value the chain last mirrored (parent[key] === before - revoked by direct reassignment). A revoked write completes on the disconnected chain value - a wasted copy, never corruption - matching sequential semantics, where the later operation's assignment or delete overwrote that write anyway. In particular, a delete followed by a resumed write cannot recreate the deleted path.

Reassignment or delete at an ancestor orphans the whole subtree instead: local mirrors inside it may still succeed (the guard is deliberately local), but every effect is confined to the disconnected branch - a waste, not a validity issue - and the live tree matches sequential semantics, where the ancestor operation discarded that branch anyway.

COW forks of edges holding promises cannot reorder anything either: the copy's record is seeded from the source record's `current` at the copier's own FIFO slot and the captured value is marked immutable, so the copied world contains exactly the writes of operations issued before the copy, and operations issued after advance the two chains independently through copy-on-write (see Value resolve - Fork).