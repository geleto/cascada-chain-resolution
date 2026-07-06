I am implementing a programming language that uses copy-on-write for variable assignment and modification.
We support objects and arrays, the language is compiled into JavaScript.
But whenever possible we shall still reuse the structure.
When modifying only a child property - we shallow copies the object at each level along the modified path, iterating deeper only along the path and finally setting the changed property.


// Illustrative code to show shall-on-each-path-level copying
function simpleAssignPath(root, segments, value) {
  // No segments left: replace the whole value.
  if (segments.length === 0) {
    return value;
  }

  const [head, ...tail] = segments;

  if (root === null || typeof root !== "object") {
    return { [head]: simpleAssignPath(null, tail, value) };
  }

  const newChild = simpleAssignPath(root[head], tail, value);

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

Additionally, promises are handled transparently. If a property is set to a promise, once that promise is resolved, it is replaced by the resolved value automatically. If the value rejects, it is replaced by the Error object. Also assignPath can receive an Error object as value and it has to be properly referenced(see CLEAN). Any operation or walk that encounters a settled-but-unreplaced promise replaces it in place (with CLEAN propagation), and registers writeback for pending unregistered ones it discovers.

We have these operations/helpers:
import(obj, rescan=true) - for marking outside objects immutable. If rescan is true - walks obj to find promises. Errors shall not be counted - this is an internal mechanism to the language and an object that exits the language is collapsed to a single Error. Works with promises - it is marked as immutable after resolve. External objects are not expected to be mutated by outside code.
assignPath(root, segments, value) - for changing the whole object or any path value. Any branch/property with the non-mutable marking will be copied-on-write. Importing objects with promises is not recommended as the imported object will have the promise rewritten to the resolved value. For a data chain, missing/null/undefined intermediate path segments are created as blank objects; assigning through an existing primitive/untracked intermediate turns that property into an Error. Path segments are objects, properties are assigned. An Error at the target key is replaceable; an Error used as an intermediate path node is not entered.
deletePath(root, segments) - for deleting a path. Empty path deletes/replaces the whole root and returns null. Can not be used on arrays. It is of course possible to use transformation that creates a new array without the element, but this is done outside the variables. An Error at the target key is deletable; an Error used as an intermediate path node is not entered.
lookupPath(root, segments, sharedOwnership=true) - returns the value. By default the return is marked as immutable, because the value is now shared between its owning variable/path and the caller; because of this even root access has to go through lookupPath. If sharedOwnership is false, the lookup does not create shared ownership, so the returned object/array is not marked. This is valid for pure read/inspection, or when ownership is ceded to the caller as the last use of the original owner.
normalize(full) - marks the whole thing as copy-on-write/immutable, waits for all promises to resolve. It leaves the copy-on-write/immutable marks through the object. Set full=true to perform complete copy with no marks left. If there is any Error in the object - the return is a single Error (just a single error indicating multiple errors - this is a sandbox test implementation). It repeats scanning/awaiting until the reachable branch contains no pending promises. Returns a promise that resolves to a complete object with no promises/errors in it, or an Error object if any Error or rejecting promise was still left.
hasError(root, segments) - whether the property is an error, or there was an error along the path. Resolves the path(returns true if that fails), then checks the reached branch for errors (resolving any promises, etc…)

All of these except hasError and normalize run immediately, we do not await one operation before running the next. One thing to keep in mind - the first to await will be the first to continue execution, so operations will run in order despite awaiting the same promises, there will be no race conditions. All operations (the actual calls: assignPath, lookupPath, normalize/etc…) to the same root shall happen sequentially - this is enforced by the implementer. Sequentially means issued and committed in program order, not awaited to completion: each operation's synchronous prefix runs to the end - committing its synchronous changes and registering its continuations at its own program position - before the next operation is issued. Suspended remainders complete later, in that same order per promise (FIFO). No operation is ever awaited before the next one is issued - that would serialize the program and make the FIFO machinery pointless.

Immutability is evaluated only from the point of the target language. Promises and resolved values are interchangeable (promises are implicitly resolved), none of the markings are visible, etc… The immutable mark is a non-enumerable Symbol property ignored by the language.

A promise exposed through shared-ownership lookupPath/import carries the same IMMUTABLE obligation as a directly returned object/array. If it resolves to an object/array, the resolved value is marked IMMUTABLE before consumers can observe it.

Shallow Copy - a COW copy duplicates the language-visible enumerable string keys of the object/array into a fresh object/array, preserving array length. As the object that requires such copying is immutable, the copy is the new owned/unmarked node. The source object keeps any immutable mark it already has; marks are never removed. Reused non-path child objects/arrays copied from an immutable branch are also marked, so shared references stay protected. The current path child is tracked by the walk's inherited-immutable state and becomes owned/unmarked after it is replaced or copied for the current mutation, unless the assigned/reused object already carried its own immutable mark. Another, simpler approach is to deep-freeze the whole copied branch. And a third approach is to add both IMMUTABLE and NOT_IMMUTABLE markings, and using not-immutable for the new along-the-path properties. The copy never inherits hidden metadata such as the source's promise mirror map (see Value resolve) - it starts with its own, fresh one. Every copied key that holds a promise is forked eagerly at copy time (see Value resolve - the Fork birth point); non-path promise captures are marked immutable, while the current path promise is protected by inherited immutable state when the walk advances through it. The scan is O(width of the node), the same order of cost as the copy itself.

Marking Immutable (requiring copy-on-write) - All branches that are immutable are marked at the root. The mechanisms to mark an object immutable are 2 - import and shared-ownership lookupPath. Imported data need not be modified and this is the only semantic state import adds - mark; with rescan it may also register promise mirrors/writebacks for promise-valued descendants. When we have a shared-ownership lookupPath at a sub-branch - it has to be marked as immutable too. So nested immutables are fine. An immutable mark logically also applies to children, but they need not carry it. Mutating walks therefore keep track of whether the current path node is inside an immutable branch, even if the node itself has no direct IMMUTABLE mark. All operations that pass/return/store a whole existing object or branch must use sharedOwnership=true unless they can prove ownership is not shared; pure inspections and final ownership transfer may use sharedOwnership=false.

Value resolve - each node carries a hidden promise mirror map (under a Symbol), created for every key that was assigned a promise. Each promise mirror stores {promise, currentValue}: the exact promise assigned to that key, and the newest version of its resolved value. `currentValue` is changed by each operation that mutates it, in operation order, so each op's change is applied on top of the previous `currentValue` rather than on the original resolved value. A normal owned promise writeback does not mark the resolved object/array immutable; the resolved value is still owned by the single Cascada location that received the promise. Import and shared-ownership lookupPath mark resolved objects/arrays because they cross an ownership boundary. Forked non-path promise mirrors also mark the captured value because a copied world and the source world initially reuse that same `currentValue`; a forked current-path promise instead COWs from the walk's inherited immutable state if the walk advances through it. The resolved value is written back into its property only if its promise mirror is still the one the map holds for that key. If a later op has since reassigned the key (even to the same promise) - a new promise mirror is created. Even if not written to the node property - we keep `currentValue` alive privately - for reads that captured the mirror - without touching the node property. Every synchronous overwrite/delete through the runtime must clear the promise mirror map for that key, even when assigning the same value. All required accessible promises must start resolving immediately: we use .then and continue walking rather than await + enter, leaving other immediately accessible promises to resolve in parallel (and yet in operation order as guaranteed by JS).

A promise mirror is born at exactly three points, and where its starting `currentValue` comes from differs:

- Assignment: a promise is assigned to a property (assignPath value, literal initialization). A fresh promise mirror is always created, even if the same promise instance was already at this key - two assignments are divergent worlds and must not share `currentValue`. The writeback continuation is registered immediately at assignment, before any operation can register on that promise for this key, so the writeback is always the first responder and `currentValue` starts as the raw resolved value.

- Discovery: a walk or operation reaches a promise key that has no mirror (imported data, raw literals - any orphan). The mirror is created and its writeback registered at the discovering operation's program position; `currentValue` starts as the raw resolved value.

- Fork: a copy-on-write shallow copy duplicates a key that holds a promise. The copy's promise mirror must be created eagerly, at copy time - never minted lazily by a later walk. A lazily minted mirror would seed `currentValue` from the raw resolved value, silently losing every mutation made by operations issued before the copy. At copy time, for each copied key that holds a promise: ensure the source node has a mirror (Discovery, if it is an orphan), then create the copy's mirror and register its initializer immediately, at the copier's program position. This initializer never reads the raw resolved value - it reads the source mirror's `currentValue` at its own FIFO slot and uses it as the copy's starting `currentValue`, mirroring it into the copy's property only if the copy's key still holds the promise unchanged. Non-path captures are marked immutable because they are now reused by both worlds; the current path capture is left unmarked and relies on the walk's inherited immutable state if the mutation continues through it. Because the initializer is registered at the copier's program position, it observes exactly the advances of operations issued before the copy and none issued after - the two worlds diverge at precisely the copier's place in program order, uniformly for pending and settled-but-unreplaced promises. After the fork the mirrors are independent: operations traversing the copy advance the copy's mirror, operations traversing the old node advance the source mirror, and either an immutable mark on the captured value or inherited immutable state forces the first advance that would mutate a reused value to copy. Value advances themselves go through the same shallow copy, so a resolved value that contains nested promise keys is forked by this same rule automatically.

assignPath - If it reaches a promise in the intermediate path it resolves it and continues through the mirror's `currentValue` (see Value resolve), COWing that value and advancing the mirror. If an intermediate path segment is missing/null/undefined, create it (a blank {}). If an existing intermediate property is primitive/untracked, replace that property with an Error and stop. Continue through the path (resolving any promises along the way), assigning the value when the path end is reached. Because it is the first to await the promise, it is the first to resume and modify. When it reaches an object marked immutable along the path it copies it (the COW approach above). assignPath into an intermediate error node is a no-op, while assignment at an Error target replaces it. It installs the copied spine top-down as it descends, so the new root identity is decided synchronously and rebinding is synchronous; the variable must be associated with the returned root before the next command is issued. The return may be a synchronous new or old root, or a promise for the new root only when the root itself is pending, or an Error when the root is already an Error. A rejecting return value shall be resolved as Error.

lookupPath - returns the value it reaches. If that value is a promise, or if a promise lies along the path, it returns a promise that resolves to the value once reachable - continuing through `currentValue` if the path was mutated during resolution (see Value resolve), never the raw resolved value. The returned promise is not awaited by lookupPath itself; values resolve only at the point of consumption. If sharedOwnership is true, marks the return immutable if it is an array or object; if the return is a promise, it ensures the resolved value is marked immutable. sharedOwnership=false lookups are for inspection or final ownership transfer and do not share ownership. Return semantics otherwise as assignPath. Any Error or rejecting promise along the path results in an Error return.

deletePath - resolves the intermediate path segments to reach the target (a segment may be a promise, continued through `currentValue` per Value resolve, not awaited), then deletes it, clearing the key's promise mirror so no later writeback re-mirrors it. COWs immutable branches along the way (the COW approach above). Objects only; array element deletion is a no-op in this helper. Any intermediate Error along the path is a no-op, while an Error target can be deleted. Returns the new root, with the same synchronous/pending/Error semantics as assignPath.

Optimizations:
RefCounting is possible (we can not have cycles and reused objects can flow their ref counts to multiple parents), so we shall decide if we shall switch to ref-counting or continue to use CLEAN.

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
assignPath - if clean!=newClean for replaced property - propagate the state to the parent(s). Updates the parents set. If we have a new property - evaluate clean!=newClean for the parent and propagate if needed.
deletePath - trackedKeyCount–, if was clean, cleanCount–, otherwise if now clean - propagate. Updates the parents set.
lookupPath - if a promise is resolved to a clean value - propagate
import - not clean
normalize - updates the clean state of the branch depending if there were any errors, if clean - propagate
isError - similar to normalize

We need node.makeClean(true/false) that takes care of the propagation. Clean stops at the first non-clean node,
Initializing trackedKeyCount - use a getter for trackedKeyCount and cleanCount that initializes these, cleanCount starts with 0 and trackedKeyCount is properly calculated

Correctness:

Cycles: It is impossible to have cycles.
a.property.subproperty = a
The moment we read `a` through lookupPath it becomes immutable. The moment we modify subproperty - `a` becomes copied (simpleAssignPath), thus it is a new object, no cycle. Import values will not be allowed to have cyclic data (either by requirement or actively validated on import)

Object reuse: Any object that is reused - the runtime-visible ways this can happen are import and shared-ownership lookupPath, which mark the object as IMMUTABLE. An assignment and initialzier can target only one variable, so that the ownership is clear. var x = {a:1, b:2} - is owned by x and needs no immutable mark. An async assignment to one variable is still owned by that one variable after the promise resolves. But var y = x will make the object immutable for both x and y. External values enter through import, so their resolved data is immutable-marked through the same mechanism. A pure read or final ownership transfer uses sharedOwnership=false and therefore does not mark it.

Race conditions: with assignPath and deletePath, it may look as if we are opening the possibility for race conditions. While one operation awaits a promise that resolves some data, a subsequent operation may modify the data - or commit synchronously and overtake the suspended one entirely. Why neither can corrupt anything or diverge from sequential semantics:

Program order = FIFO order. Operations are issued in program order and register their continuations at their own program position; JS runs continuations on one promise in registration order. So all consumers of one promise mirror resume in program order, each advancing the mirror's `currentValue` on top of the previous operation's version (V → V′ → V″). Immediate resolution of all accessible promises is required for this to hold (use .then and keep walking, never await + enter).

Owned promise writeback does not mark by itself. Escape marking (shared-ownership lookupPath/import) and fork marking are what force advances to copy instead of mutating a value that another consumer or forked world still references.

Suspended reads are immune to overtaking writes: a suspended lookupPath continues through the mirror's private `currentValue`, never the live property. A later operation that synchronously reassigns or deletes the key (clearPromiseMirror + assignment) is invisible to it - the read resolves to the mirror value as of its own program position, exactly what sequential execution would have returned.

Suspended writes are fenced by the promise mirror map: a resumed write mirrors into the live tree only if its mirror still owns the key (map[key] === mirror - revoked by a later assignment or clearPromiseMirror). A revoked write completes on the disconnected mirror value - a wasted copy, never corruption - matching sequential semantics, where the later operation's assignment or delete overwrote that write anyway. In particular, a delete followed by a resumed write cannot recreate the deleted path.

Reassignment or delete at an ancestor orphans the whole subtree instead: local mirrors inside it may still succeed (the guard is deliberately local), but every effect is confined to the disconnected branch - a waste, not a validity issue - and the live tree matches sequential semantics, where the ancestor operation discarded that branch anyway.

COW forks of keys holding promises cannot reorder anything either: the copy's mirror is seeded from the source mirror's `currentValue` at the copier's own FIFO slot and the captured value is marked immutable, so the copied world contains exactly the writes of operations issued before the copy, and operations issued after advance the two mirrors independently through copy-on-write (see Value resolve - Fork).

