# Cascada chain resolution

*How Cascada keeps deeply async data ordered, fast, and safe - without ever waiting.*

This repository is a sandbox implementation of the chain command engine behind Cascada variables. This document explains how it works, for readers who know programming and promises but nothing about Cascada's internals.

## The setting

Cascada is a data orchestration language. Three principles shape everything below:

- **Cascada is implicitly async.** Any value may be a promise, and you use it as if it were already there. A property can hold a promise, and the language treats it exactly like the value it will become. Cascada-owned properties eventually receive the settled value; imported host objects remain untouched and expose it through runtime metadata instead.
- **Errors are values.** A failed operation doesn't throw. It leaves an *error value* where its result would have gone - in a variable, in a property, anywhere. The most common source is a promise that rejects: its error value simply takes the place its result would have taken. The error travels with the data until something checks for it (we call this *error poisoning*).
- **Variables hold values, not references** (*value semantics*). Assigning a variable to another, or reading part of one into another, behaves like handing over a *copy*: changing one afterwards never changes the other. (The engine avoids actually copying for as long as it can - more on that later.)

Because Cascada orchestrates data, structures are large and deep - and promises can sit at any depth inside them. Two words for what follows, using a JSON-like value:

```js
let order = {                    // node  (the value at the top)
  customer: { name: "Ana" },     // node
  items: [                       // node
    { sku: "A1", qty: 2 },       // node
  ],
  total: computeTotal(),         // a promise - can sit anywhere
}
```

Every object or array here, at any depth, is a **node**. A node together with everything inside it is a **branch**: `order.items` with its contents is a branch, and so is the whole `order`. All the machinery below works per node, not per variable.

## Language data and outside data

Cascada can trust values created by its own compiler. A new object has one owner. If it is read into another variable or stored somewhere else, that read marks it shared; a later write then copies only the changed path. Even `a.prop = a` does not create a self-cycle: the right-hand side is read first, so `prop` receives the value of `a` from before the property was added.

JavaScript values brought in from outside Cascada cannot be assumed to follow those rules. The same object may appear under several properties, and an object may point back to itself. Every external value therefore passes through `import`, which records the imported root and its error context but does not immediately search the graph. Ordinary reads and writes stay cheap. The alias and cycle work is delayed until `hasError`, `getErrors`, or `normalize` first needs exact information anywhere inside that boundary.

That first whole-branch operation starts from the recorded import root, even if it was requested for a nested path. A depth-first walk visits each object once; a repeated object is an alias, while a property pointing back into the current path is recorded as a cycle cut. Starting from one stable root keeps the result independent of which nested path happened to trigger preparation. A branch extracted from the import, reused by copy-on-write, or produced by an imported promise becomes a new boundary rooted at that independently used branch.

The imported JavaScript object is never rewritten. Cascada keeps settled promise values and cycle diagnostics in private metadata beside it. A normal path read or write still sees the original logical value. A cycle Error is diagnostic rather than poisoning: `hasError` may report it even though `normalize` preserves the raw aliases and cycles.

The language sees only own enumerable string properties. That includes an own enumerable `__proto__` data property, which is read, counted, copied, and mutated like any other key. Inherited properties remain invisible. Every missing language key is created as an own enumerable data property, so assigning `__proto__` never invokes JavaScript's legacy setter or changes the object's prototype.

## The command chain

Cascada compiles your statements into a chain of commands per variable, issued in program order. The main ones:

| command | meaning |
|---|---|
| `assignPath(v, ["a","b"], x)` | `v.a.b = x` |
| `lookupPath(v, ["a","b"])` | read `v.a.b` |
| `deletePath(v, ["a","b"])` | `delete v.a.b` |
| `import(x)` | bring data from the outside world into the runtime |
| `hasError(v, ["a"])` | is there an error anywhere inside `v.a`? |
| `getErrors(v, ["a"])` | collect every distinct error inside `v.a` |
| `normalize(v, ["a"])` | hand out the current state of `v.a`, with every promise inside it resolved |

The contract is simple: **the result must be exactly what you would get by running the commands one at a time, to completion, in program order.** The interesting part is honoring that contract without paying its obvious price - waiting. No command waits for the previous one's promises to finish; every command starts immediately.

## The obvious way - and why not

The intuitive implementation waits for every promise it meets:

```js
order.total = computeTotal()      // this property now holds a pending promise
order.total.currency = "EUR"      // needs the total - so it waits... fine
order.notes = "gift wrap"         // no promise anywhere near it - stuck in line anyway
```

If each command waits for the previous one to finish, the third line - which touches a different property and needs no promise at all - cannot run until the computation lands. One slow promise serializes the entire program behind it.

## Cascada's way: never wait

Every command runs **immediately and synchronously, as far as it can**. When it runs into a pending promise, it attaches a `.then` callback - *"continue me from here"* - and returns at once. The next command starts right away.

What keeps the results correct is a guarantee JavaScript gives for free:

> Callbacks attached to the same promise run in the order they were attached.

Commands are issued in program order, so their callbacks attach in program order, so they **resume** in program order. Commands waiting on a promise form a line, and the line preserves the program:

```js
order.total = computeTotal()     // (1) the property holds a pending promise
order.total.currency = "EUR"     // (2) attaches to the promise, steps aside
order.total.rounded = true       // (3) attaches behind (2), steps aside
log("still running!")            // the program never stopped
```

Notice the counterintuitive part: (2) and (3) write into a value that *doesn't exist yet* - and even they don't wait. They queue up behind the promise and apply themselves the moment it arrives: (2) resumes first and makes its change, then (3) resumes and sees (2)'s change already applied. Exactly like sequential execution - minus the waiting.

## Mirrors: when the data changes under a waiting command

Alongside each node, the runtime keeps a **mirror**: a small side record with one entry per property that currently holds a promise. The entry remembers *which* promise sits there, and the **newest version of its value**. Commands that wait on a promise do their work through the mirror entry - never directly through the live property.

Why the indirection? Because never waiting creates one hard case: a later command can **overwrite the very promise an earlier command is still waiting on**.

```js
config.db = loadConfig()        // (1) pending - the mirror gets an entry for "db"
config.db.port = 5432           // (2) waits, in line behind the promise
config.db = { port: 9999 }      // (3) doesn't wait - replaces the property right now
```

What *should* happen? Run it sequentially in your head: the config loads, (2) sets its `port` to 5432, then (3) throws that object away and stores `{ port: 9999 }`. Final answer: `{ port: 9999 }`. (2)'s write happened - and then was discarded.

Here is how the mirror produces the same answer without anyone waiting:

1. When the promise resolves, its value lands in the mirror entry first.
2. Waiting commands resume in order, each preparing its change on the entry's newest value, so each one sees every earlier command.
3. While registered commands remain in line, the mirror is still considered pending. A later read joins that line instead of taking a half-finished value synchronously.
4. When the line is fully drained, its final value is copied into the real property only if the mirror still owns that property, the holder belongs to Cascada, and the holder is still extensible. Imported or non-extensible properties keep their raw Promise and expose the settled value through the mirror.
5. Overwriting the property, as (3) does, *detaches* its mirror entry. Commands issued later cannot reach the old promise, while commands already in line keep their private reference and finish off to the side.

So in the example: (3) replaces the property and detaches the entry. But (2) had already joined the line and still holds it. When the config loads, (2) completes its write on the entry's value, but the final live-edge check stops it there because the property has moved on. The write lands nowhere visible. Final state: `{ port: 9999 }` - the sequential answer, with no locks and no rollback. A superseded write simply finishes quietly off to the side.

Seen from above, a mirror entry is a private relay between the commands queued on one promise: each resumes at its turn, takes the newest version of the value from the entry, applies its own change, and leaves the result for the next in line.

Reads use the same line:

```js
config.db = loadConfig()
let db = config.db              // (2) will receive what loadConfig produces...
config.db = { port: 9999 }      // (3) ...even though this replaces it immediately
```

(2) attached before (3) ran, so it reads the mirror entry's value at its place in line: the loaded config, untouched by (3). Again - exactly what sequential execution would have returned.

## Copy-on-write: acting like copies without copying

Recall the third principle: variables behave like copies. After

```js
let b = a          // the reading half of this is a lookupPath command
```

`b` must act as if it got its own private copy - a later `a.x = 3` must not show through `b`. Copying `a` for real at that moment would honor the rule, but most data that gets read is never written again, so most of those copies would be pure waste.

A node starts out **owned**: only the variable that created it can reach it, which is why changing it in place is safe. Reading it into a second owner is what changes the picture - and the engine handles that the cheapest legal way: the read (`lookupPath`) just **marks** the node as *shared*, and everyone keeps using the same one. The rule that makes this safe: a shared node is never changed in place. The first write that touches it makes the copy - that's *copy-on-write*, paying for the copy only if and when the two variables actually need to differ.

Not every lookup results in shared data, though. `lookupPath` takes a `sharedOwnership` flag, and the compiler passes `false` in two cases: a pure inspection, where nothing will keep holding the value; and the variable's *last use*, which actually **transfers ownership** - in `return x`, `x` will never be observed or mutated again, so the caller becomes the node's single owner. No mark, no future copies.

One more saving: even then, there's no deep copy. A structure is copied by shallow-copying each level along the path from the root down to the changed spot, putting the new value there - and reusing everything else untouched:

```js
let doc  = { meta: {...}, body: { title: "Draft", sections: [...] } }
let body = doc.body          // body is now shared
doc.body.title = "Final"     // copy-on-write kicks in
```

```text
before                          after the write

   doc                             doc2  (new)
  /    \                          /    \
meta    body                   meta    body2  (new)
        ├─ title: "Draft"               ├─ title: "Final"
        └─ sections                     └─ sections
                                 ▲          ▲
                                 └─ reused ─┘  (same nodes, not copied)
```

Two nodes were copied (`doc` and `body` - the levels on the path), and everything else is shared between the old and the new tree. The other variable still sees `"Draft"`; `doc` sees `"Final"`. The reused pieces now live in *two* trees, so they are marked shared as well - a later write into them will copy again. Copies spread only as far as writes actually reach.

A few notes, deliberately brief:

- For ordinary copy-on-write, one mark at the top of a shared branch is enough: a write walking downward remembers "I'm inside a shared branch."
- A pending promise can't be marked (its value hasn't arrived), so the runtime attaches one extra step to it: *when you resolve, mark whatever arrived.*
- The root of `import`ed data is marked shared immediately. A descendant gets its own rooted boundary when extraction, COW reuse, or promise settlement makes it independently usable. Lazy preparation marks only identities reached by more than one imported path; unique descendants rely on the inherited shared branch. We never write into someone else's objects; changing imported data always copies.
- Frozen, sealed, and otherwise non-extensible nodes are implicitly shared. Writes COW them, while whole-branch queries index them through WeakMap metadata just like extensible nodes.
- If an imported property contains a promise, the host property remains that same promise after settlement. Its mirror holds the logical settled value seen by Cascada.
- If a copied node has a property still waiting on a promise, the copy gets its own mirror entry for it - from that moment the two trees receive the value independently and can diverge.

## Counting instead of searching

Three commands ask about a **whole branch**: `hasError` - *is there an error anywhere inside?*, `getErrors` - *which errors are inside?*, and `normalize` - *hand out its current state, fully resolved*. Answering by searching would mean walking the entire structure, again and again as promises keep landing. Instead, the runtime counts.

Each node can carry two numbers:

- `promiseCount` - how many promises are still pending anywhere inside it,
- `errorCount` - how many error values or imported-property error markers it contains, at any depth.

Most variables are never queried this way, so by default nobody counts anything. The first `hasError`, `getErrors`, or `normalize` on a branch walks it once and sets the counters up - a walk it would have needed anyway. From then on the branch keeps counting itself: every command knows exactly what it removed and what it added (assign a promise: +1; it resolves: −1, plus whatever its value brings along; delete: subtract what left; replace: both at once), and pushes the difference up to the **parent nodes** - each counting node keeps links to the nodes that contain it - so the numbers stay exact everywhere, without ever walking again.

An imported cycle cannot be placed directly into this recursive counter graph. Cascada records the cyclic property as one error for whole-branch queries and stops the counters at that edge, while leaving the original property and object graph untouched. Ordinary finite path operations can still cross it.

With the counters in place:

**`normalize`** hands out the branch's current state with every promise inside resolved. Its first move is to **pin the branch**: it marks it shared - the same mark copy-on-write uses - so it cannot change underneath it. Later writes copy and go their own way; the pinned branch can only settle. All that's left is ***when***: when has every promise now inside settled, including any new ones their results bring along? The counter answers it - `normalize` subscribes to `promiseCount` reaching zero, and the zero *is* the completion signal:

```js
user.profile = fetchProfile()   // will resolve to { avatar: fetchAvatar() }
let done = normalize(user)      // waits for fetchProfile - then fetchAvatar too
user.stats = fetchStats()       // lands in a copy - the pinned branch never sees it
```

Internal Cascada code may keep the normalized branch itself. A value leaving Cascada asks for a plain copy, which materializes logical mirror values, preserves aliases and cycles, and carries no runtime metadata.

**`hasError`** answers for the branch as it is *now*: `errorCount > 0` - `true`, immediately; `promiseCount` at `0` - `false`, immediately, nothing is in flight. Only pending promises make it wait, and it follows just the branches that hold them, stopping the moment any `errorCount` turns positive: the first error wins.

**`getErrors`** follows the same issue-time promise frontier but collects Error identities instead of stopping at the first one. It therefore waits for every captured promise and every promise exposed by their results, returning each Error object once even when several paths reach it.

Like every other command, none blocks the program - the next command runs immediately; you await the returned promise only where you actually need the answer.

## One record per node

All the bookkeeping above - the shared flag, mirrors, counters, and imported-property errors - lives in a small record the runtime keeps for each node. The record starts empty and gains fields only as their features become active; a fully active record can look like this:

```js
{
  shared: true,              // the copy-on-write flag, absent until set
  importBoundary: {          // present on a direct imported boundary
    root,
    errorContext,
  },
  mirrors: {                 // one entry per promise-holding property -
    db: { promise, currentValue, cycleError, pendingConsumerCount },
  },
  cycleErrors: {             // projected cuts, when present
    self: cycleError,
  },
  promiseCount: 0,           // the counters - maintained once the branch
  errorCount: 0,             //   has been queried at least once
  parents: Map,              // who contains this node (for count roll-up)
}
```

A copy gets its own record, not the original's: it starts owned again, with its own mirror entries and no parent links yet. If the source was already counted, the copy rebuilds each copied edge's contribution and parent link in its new world. Its totals are often the same, but placement-specific promise and error state is never copied blindly.

## What all this buys

- **The program never blocks on data.** Commands run the moment they're issued; promises resolve in the background, in order.
- **Results are indistinguishable from sequential execution.** The attach-order guarantee plus mirrors make overtaking writes and reads land exactly where a one-at-a-time execution would have put them.
- **Variables act like copies, at almost none of the cost** - copies happen only where writes meet shared data, and only along the written path.
- **"Did it fail?" is one number away, and "when is it done?" announces itself** - no searching: a branch is walked once, the first time it is ever asked, to set up its counters; after that every question just reads a number, and completion is simply the counter reaching zero.
