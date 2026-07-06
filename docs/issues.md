Let me think about what you're actually naming, because there are two different things and they want different kinds of names.

The **algorithm** is the specific mechanism: per-key promise mirrors with an advancing `currentValue`, FIFO-ordered resume, fork-at-copy. That wants a precise, technical name — something you'd write in a paper's title. The **project** is the language/runtime this lives in (Cascada already exists as the parent, so this might be a subsystem name). That can be more evocative.

## For the algorithm

The load-bearing ideas are: copy-on-write, promises resolved in program order without awaiting, and the per-key promise mirror that keeps concurrent mutations from clobbering each other. Names that capture the distinctive part:

- **Promise Mirrors** / **Promise-Mirror Resolution** — foregrounds the actual novel unit (the per-key mirror over a promise-valued property). Precise, papers well.
- **FIFO-Ordered Copy-on-Write** (FOCOW) — names the two pillars; the acronym is unfortunate, so probably a subtitle not a name.
- **Program-Order Resolution** — captures the real guarantee (concurrent-looking ops resolve as if sequential). This is the *property*, which is often the better thing to name than the mechanism.
- **Deferred-Value COW** — signals that values can be pending and the structure copies around that.
- **Mirror-Advance Resolution** / **Advancing-Mirror COW** — literal description of `V → V′ → V″`.

My pick for the algorithm: **Promise-Mirror COW**, with **program-order resolution** as the property it guarantees. The word "mirror" is doing real work in your spec: it names the private `currentValue` plus the guarded writeback into the live object.

## For the project

Since it's the concurrency/COW substrate under a reactive language, I'd lean toward names evoking *flow that forks and rejoins* or *ordered settling*:

- **Rivulet** — small streams that branch and rejoin; fits the fork-and-diverge worlds, sits nicely under "Cascada."
- **Delta** — river delta (branching channels) *and* "delta" as in change/COW. Double meaning, short. Risk: overloaded word.
- **Braid** — independent strands (the forked worlds) running in parallel without tangling. Clean, memorable, not taken in this space as far as I know.
- **Weir** — a structure that controls flow order in a river; nods to FIFO ordering. Obscure but distinctive.
- **Confluence** — where streams merge in order; evokes the ordered-resolution guarantee.
- **Ripple** — reactive change propagation; lighter register.

Given the Cascada lineage (cascade → water imagery) and that the algorithm's whole story is *branches that fork and evolve independently in order*, **Braid** is the one I'd push hardest — it names the exact thing that's hard (many strands, never tangled) and it isn't water-cliché. **Rivulet** is the safe on-theme second.

If you want the pairing to read well in a sentence: *"Braid, a concurrent copy-on-write runtime using promise-mirror resolution to guarantee program-order semantics."* That's a clean one-liner for a repo description or a talk abstract.

Want me to check whether any of these (Braid, Rivulet, the algorithm names) collide with existing PL/runtime projects before you commit? That's worth a search, since name collisions in this space are common and you'd want the npm/GitHub handle clear.
