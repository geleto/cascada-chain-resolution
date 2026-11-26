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
