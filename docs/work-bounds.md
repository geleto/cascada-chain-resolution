# Bounded Graph Work

This document specifies the mechanisms that keep graph work within the values, paths, results, Promise frontier, and maintained dependencies selected by an operation.

## Context authority discovery

Initial context import filters the finite [compiler mutation access tree](integration.md#compiler-construction-of-the-mutation-access-tree), reading only its named original placement occurrences. Every recursive step consumes a compiler edge. Record requested external scopes, continue through their named native child data placements, and prune managed endpoints and empty connecting branches. Never enumerate opaque interiors or consume thenables for discovery. Context aliases and cycles require no subtree enumeration, relative-path cache, or discovery cycle tracking. Allocation is bounded by the requested routes and resulting runtime records; no preliminary copy of the compiler tree is needed.

Ordinary import separately inspects each newly admitted managed identity once. Discovery reuses those category facts and may encounter the same identity along distinct requested routes because location uniqueness is occurrence-sensitive. An unrequested route creates neither reflection work nor a registration. Runtime trees remain fixed after commit; current authority comes from shared identity entries.

## Cycle cuts

Refcount cycle cuts may require a counter-selected walk when maintained counters cannot answer across a cut. All such walks in one operation share one visited set and inspect each identity at most once. Building a missing index may use a separate pass.

## Input preparation and retention

Common input preparation establishes a fresh managed input's logical placements once, including pending delivery obligations. Already prepared active data uses its maintained index; retired data restores relationships from authoritative forward state without repeating admission or host inspection. Preparation does not perform a separate Promise-presence walk.

Root placements and temporary leases preserve received values. Ownership derives from current incoming placements, imported protection, and leases; there is no permanent shared mark. Consumers transfer protection when they have captured the exact versions or identity they need. A scalar conversion or identity comparison therefore need not retain its original input container while an unrelated argument remains pending.

## Array ranges

`slice` converts each consumed bound once and captures the normalized range. Candidate enumeration can stream a short interval or filter stored keys for a broad sparse interval. It merges the selected physical keys with logical versions and status in numeric order. A slice of a million-slot Array with two stored indexes can preserve the intervening holes as a single gap. Only selected element descriptors are needed.

Pending length sequences have independent revision counters. A growth outcome invalidates only retained sequences containing that contribution; a private fork's completion causes no scan of an unchanged original. Repeated questions reuse current bounds until a relevant outcome changes. Fork construction and subscription attachment or removal visit their own captured frontier. Counter registrations end with the last Array or reader use, and retain no passive sequence or Array through a completed or unrelated source.

## Controlled Array work

Include a pending middle deletion followed by pending pushes, overlapping copies of pending payloads, alternating pushes and reversals, and a chain of concatenations with separately pending operands. Count copied producers, shape notifications and retained reader callbacks across increasing history depths. Hold an unrelated input pending through collection. Count a closed cursor with an unfinished pull separately from a completed search or pull.

Repeated pushes and pending deletions compose their numeric changes. A settled count must not send every intermediate bound through every later snapshot. Retain each push result and read the length after each splice. Reverse the count deliveries and check the final export and every scalar against issuance-order native execution. Count visits to width links and membership questions as well as dispatched updates. Exercise both a growing history and one that shrinks to the splice's fixed prefix. An earlier length or index waits only while its own answer can change. [Historical width work and progress](../test/fixtures/array-pending-history.mjs)

Retaining one positional lookup per version adds one scalar answer. At `d6e668c` both a repeated front deletion after append and the variant with a prepend and tail trim exhibit quadratic positional work when counts of one arrive in reverse. Count the actual mapping/index records visited and the entries copied when batches split or merge, through holder release. Track width separately from notifications and output. Keep a no-reader control, a receipt from public lookup, and a later point that can settle while an earlier count is held. The strict growth check covers both histories. [Workload](../test/fixtures/array-pending-history.mjs#L299) · [Acceptance](array-iteration-robustness.md#known-work-bound-violation)

Successive fixed prefixes and snapshots share captured layout fragments. An insertion within a known prefix consumes each retained occurrence once, including when its position moves between calls. Issuing the insertion or settling a common width must not copy every earlier pending slot into each backing. Reads of known scalars, settled observation-only identities and ordinary rejected payloads use the captured slot directly. When an optional counter index is active, ordinary rejected payloads publish to that index through the existing fixed-layout links. A delivered managed child still acquires every exposed parent/key relationship immediately. Settling an individual point releases its gate, even with the width pending.

An independent reader requesting a layout drives its pending selections through completion. A backing can detach when its last owner, requested point, range reader and index have released it. Re-entry restores publication from captured forward state. Independent length results need only shape. Exporting each of N growing snapshots can itself produce quadratic output.

A pending splice start selects the prefix and suffix together. Issuance captures the operands. The selected start determines which ranges to join, while numeric bounds and Unordered occurrence queries can advance independently. A live copy releases a child once the cut excludes its last possible occurrence, even while an unrelated suffix has unknown width.

An unresolved splice start or count can determine the length or removed range without needing the inserted values. Once a streaming `splice(1, pendingCount)` and subsequent `push(child)` publish their receiver changes, clearing both holders releases the child while the count is pending. The push length still settles. This also holds for the length of a slice whose boundary can cross into the inserted tail. A historical read selecting that child or a snapshot of a derived range keeps its own data and copy-on-write protection. Each open `concat` operand follows the same rule when other operands are pending.

In Complete mode a possible whole-receiver failure can keep the push queued. It retains its captured argument until it can commit or the earlier failure rules it out. A later root assignment can acknowledge issuance immediately, while a read after that assignment waits for ordered publication. With a successful count of one on `["A","B"]`, the push returns two, a snapshot taken before replacement contains `["A", child]`, and a read after replacement sees the assigned value. Once the mutation and any actual snapshots release the child, the numeric result can remain held independently. [Whole-Array publication](array-method-specification.md#1-one-operation-separate-outcomes)

A pending splice can narrow its data capture as each control arrives. A start of 1 excludes index 0 from the removed result while the delete count is pending. A delete count of zero releases all candidates for that result. A range that includes a movable insertion protects the inserted child's captured value even after the source Array retires. For a concatenation, drop any operand or part of an operand proved outside a retained slice. Its width can still affect the slice's coordinates and the position of earlier capacity loss. [Splice and concat lifetime cases](../test/fixtures/array-sequence-lifetimes.mjs)

A pending slice keeps its bound and length questions independent of the output layout. After a streaming slice hands off its Array, holding only its length releases candidate data when the last data owner leaves. A Complete slice awaiting whole-result validation still owes its caller the captured Array on success. Its pending result retains the remaining candidates even if every Chain holder is cleared. Either bound can release excluded candidates in all modes. A known positive end can exclude a suffix immediately, even when a pending negative start can still consume the uncut source length. [Slice lifetime cases](../test/fixtures/array-sequence-lifetimes.mjs)

An unknown concat operand can make the capacity of a later endpoint edit uncertain even on a small Array. A deletion alone cannot introduce a new tail loss. For a splice with k insertions, only the inserted positions and the last k positions below the native length limit can newly cross it. Earlier virtual markers keep their roles. The count-cap growth check needs only widths. A scalar return can therefore release unrelated receiver data while capacity is pending. A method returning the receiver protects it through delivery. [Capacity cases](../test/array-capacity-layout.test.js)

One path-operation owner covers invocation, controlled input preparation, logical conversion, recursive `flat`, search continuations, comparator export, and remap construction. The coordinator closes after required publication and result processing. Component captures and leases release at their own last use. A preparation Error discards success-only assembly while required Error collection continues. A late continuation in a live execution still finishes required shared Promise settlement and bookkeeping, but performs no further operation work after closure. A continuation in a fatal execution returns at the common execution check before either kind of work.

`concat` captures each contributing range at its ordered turn. A protected prefix can be shared while another part is pending. Each source can release as soon as the capture owns the remaining data and shape. Sort keeps its captured candidates across comparator preparation. A comparator receives one exported snapshot. Repeated intrinsic checks in one operation share their failure and can share successful conversion work. Preserve the required callback sequence on success. A reached oversized Array contributes one capacity Error to full value consumption before any element traversal. A compound stores only distinct required leaves and stops when its native list would overflow. [Occurrence and collection rules](array-method-specification.md#failures-in-repeated-occurrences) · [Diagnostic capacity](array-method-specification.md#native-diagnostic-list-capacity)

Array-length assignment uses its existing path-operation owner for guarded conversion; it allocates no second owner. Ready conversion needs no release registry. Conversion drops its source captures after constructing the resize, and the coordinator closes after required publication. Local sibling closure in a live execution does not suppress required shared property settlement; execution fatality stops a resumed conversion before settlement.

## Detached results

Settlement of a detached or displaced property version stores its logical Promise version value without building a ref index or inspecting nested data. Imported settlement still performs its independent admission and Promise-placement work before liveness is considered.

Consumers discover detached data through their ordinary logical path. The fenced Error walk is the only consumer that requires maintained counters, so it indexes the reached value at its own FIFO position before consulting them. Mutation, observation, export, and remapping need no eager index.

## Bulk Array mutation

A controlled method publishes its logical mapping at the command's ordered turn. It can share an eligible range or assemble a determined result directly in private storage. Initialize the new logical relationships and active counters before exposing the corresponding placements. Live point writes keep their ordinary placement transitions. The command's prescribed writes determine identity even when the resulting values compare equal. [Array publication and bookkeeping](run.md#mutation-bookkeeping)

For `[A,B,C]!.splice(1,1)`, success publishes `[A,C]` and returns `[B]`. If a required source inspection fails the whole mutation, repair exposes `[A,B,C]`. No intermediate shift or deletion can escape. A streaming regional outcome publishes the positions permitted by its own dependency rules. [Failure and publication](array-method-specification.md#1-one-operation-separate-outcomes)

## Managed calls

A managed call explicitly consumes its complete receiver graph. Receiver preparation, mutation isolation, and finalization are separate full walks because preparation may suspend, isolation uses the protection state after preparation, and finalization must inspect arbitrary method changes. Each walk remains bounded by the receiver and explicit inputs and never expands into unrelated graph state.
