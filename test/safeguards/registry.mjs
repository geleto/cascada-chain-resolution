// Phase 2 safeguard witness registry. Each entry removes one safeguard with an
// in-memory source fault; run.mjs runs the normal suite and requires a listed
// witness test to fail. One entry per safeguard: extend or update an entry
// instead of adding a parallel fault, and delete it with the safeguard.
//
// - witnesses: substrings of mocha full titles; at least one must fail.
// - open: present only while no supported test can fail. State why (no
//   consequence found, or the witness is pending) and keep the reason current.
// Fault text matches current source; update it when the guarded code moves.

const edit = (file, find, replace = "") => ({ file, find, replace })

export const SAFEGUARDS = [
    {
        id: "displaced-writers-retain-capture",
        guards: "A detached queued writer cannot use another owner's sole placement as mutation permission.",
        faults: [edit("src/property-versions.js",
            "        if (isLivePlacementVersion(owner, key, version, operationContext)) releaseCapture?.()\n",
            "        releaseCapture?.()\n")],
        witnesses: ["ownership isolation across pending work protects another owner from a displaced"],
    },
    {
        id: "array-extension-respects-pending-growth",
        guards: "Shared backing extension preserves another owner's pending growth interval, including holes.",
        faults: [edit("src/array-view.js",
            "            if (backingRange && (backingRange.lengthState.maximum ?? backingRange.lengthState) > length) return\n")],
        witnesses: [
            "ownership isolation across pending work isolates sibling extension from pending growth",
            "ownership isolation across pending work preserves holes across overlapping growth reservations",
        ],
    },
    {
        id: "mutation-calls-capture-inputs-before-walk",
        guards: "Mutation paths cannot modify borrowed argument ancestors before capturing them.",
        faults: [edit("src/invocation.js", "    if (mutation) invocationWork.prepareArgumentFrontier()\n")],
        witnesses: [
            "invocation input ownership captures an ancestor before the",
            "invocation input ownership releases provisional inputs after",
        ],
    },
    // --- Input and outward completion handoffs -------------------------------
    {
        id: "pending-arguments-complete-delivery",
        guards: "An argument's handoff protection outlives invocation input use until direct reception.",
        faults: [edit("src/invocation.js", "        if (!this.pendingDelivery) this.close()", "        this.close()")],
        witnesses: ["invocation input ownership protects push payload delivery"],
    },
    {
        id: "unused-arguments-stop-preparation",
        guards: "A closed, untransferred input stops root discovery while shared child settlement remains independent.",
        faults: [edit("src/invocation.js", "{ kind: errorUtils.ERROR_KIND.OperationInputFailed }, this.leases.acquire, this)",
            "{ kind: errorUtils.ERROR_KIND.OperationInputFailed }, this.leases.acquire)")],
        witnesses: ["invocation input ownership abandons pending roots after unused",
            "invocation input ownership abandons pending fill payloads for empty ranges"],
    },
    {
        id: "published-arguments-outlive-invocation",
        guards: "Successful invocation transfers pending payload preparation before closing its work.",
        faults: [edit("src/invocation.js", "            this.releaseArgumentLeases()\n            this.#inputs = undefined\n",
            "            this.releaseArgumentLeases()\n")],
        witnesses: ["invocation input ownership protects push payload delivery"],
    },
    {
        id: "outward-completion-is-guarded",
        guards: "An internal defect during final outward processing fails the execution and every pending result.",
        faults: [edit("src/operation-result.js", "const bridge = continueGraphTransition(",
            "const bridge = ((value, context, fulfilled, rejected) => languageValues.thenValue(value, fulfilled, rejected, context))(")],
        witnesses: ["fatal execution guards final outward completion until settlement"],
    },
    {
        id: "outward-registration-lasts-until-settlement",
        guards: "The affected outward result remains registered while final processing can still fail.",
        faults: [edit("src/operation-result.js", "value => onFulfilled(value, fulfill, rejectResult),",
            "value => { unregister(); onFulfilled(value, fulfill, rejectResult) },")],
        witnesses: ["fatal execution guards final outward completion until settlement"],
    },
    {
        id: "observers-release-completed-source-captures",
        guards: "After synchronous capture, an observer retains pending descendants rather than their spent source.",
        faults: [edit("src/property-versions.js", "            finally { releaseCapture() }", "            finally {}")],
        witnesses: ["bounded graph ownership verifies ownership-destinations"],
    },

    // --- Liveness and retirement ---------------------------------------------
    {
        id: "retirement-runs",
        guards: "Unreachable regions retire at the end of their graph transition.",
        faults: [edit("src/ownership.js", "const dead = discovered.filter(node => !proofs.get(node).live)", "const dead = []")],
        witnesses: [
            "import releases an imported ancestor while preserving its retained child and pending publication",
            "bounded graph ownership protects pending delivery through then",
        ],
    },
    {
        id: "pins-are-liveness-roots",
        guards: "Chain holders and unfinished writers keep their regions alive.",
        faults: [edit("src/ownership.js", "if (meta.pinCount || meta.readLeaseCount) { markLive(proof); return }",
            "if (meta.readLeaseCount) { markLive(proof); return }")],
        witnesses: [
            "Array native equivalence matches shared-ancestor copy-on-write",
        ],
    },
    {
        id: "preservation-edges-retain",
        guards: "An installed recovery baseline stays live while its owning placement is live.",
        faults: [edit("src/parent-placements.js",
            "    if (meta?.preservationParents) for (const parent of meta.preservationParents.keys())\n        if (visit(parent) === false) return false\n")],
        witnesses: [
            "sort mutation retains descriptor and value failures with ready inputs",
        ],
    },
    {
        id: "backing-owners-retain",
        guards: "Array backing storage stays live while a registered logical owner uses it.",
        faults: [edit("src/parent-placements.js",
            "    if (meta?.backingOwners) for (const owner of meta.backingOwners)\n        if (visit(owner) === false) return false\n")],
        witnesses: [
            "Array native equivalence matches observation",
        ],
    },
    {
        id: "activation-is-candidate",
        guards: "Activated topology that never gains a hold, such as delivery into a retired destination, still retires.",
        faults: [edit("src/parent-placements.js", "    meta.arrayRange?.lengthState.retain?.()\n    reconsider(owner, operationContext)\n",
            "    meta.arrayRange?.lengthState.retain?.()\n")],
        witnesses: [
            "bounded graph ownership retires fresh delivery into an already retired destination",
        ],
    },
    {
        id: "retirement-unlinks-children",
        guards: "A retired parent leaves no reverse link on its surviving children.",
        faults: [edit("src/parent-placements.js",
            "        if (placement.present !== false) unlinkParent(placement.value, owner, key, operationContext)\n",
            "        if (placement.present !== false) reconsider(placement.value, operationContext)\n")],
        witnesses: [
            "Array native equivalence matches aliased nested elements mutation",
        ],
    },
    {
        id: "retirement-unlinks-counter-children",
        guards: "A retired parent leaves no optional counter link on its surviving children.",
        faults: [edit("src/parent-placements.js", "    for (const parents of meta.counterChildren ?? []) parents.delete(owner)\n")],
        witnesses: [
            "pop() preserves its earlier baseline when publication fails",
        ],
    },
    {
        id: "retirement-drops-summaries",
        guards: "Retired nodes lose counter summaries and cycle cuts, which no longer receive updates.",
        faults: [edit("src/parent-placements.js",
            "    for (const field of [\"parents\", \"frontierCount\", \"errorCount\", \"cycleCuts\", \"counterChildren\"])\n        delete meta[field]\n")],
        witnesses: [
            "ArrayView forks retained Promise versions for each derived value",
        ],
    },
    {
        id: "retirement-detaches-destination",
        guards: "A retired container loses publication authority; late settlement updates only its captured version.",
        faults: [edit("src/parent-placements.js", "    if (meta.destination) meta.destination.owner = undefined\n")],
        witnesses: [
            "Array native equivalence matches rejected Promise element observation",
            "bounded graph ownership bounds reactivation and Array extension work",
        ],
    },
    {
        id: "retirement-unregisters-backing-owner",
        guards: "A retired Array owner leaves the backing registry, restoring storage eligibility for others.",
        faults: [edit("src/parent-placements.js",
            "        meta.backingRecord.owners.delete(owner)\n        reconsider(meta.backingRecord, operationContext)\n",
            "        reconsider(meta.backingRecord, operationContext)\n")],
        witnesses: [
            "Array native equivalence matches owned in-place mutation",
        ],
    },
    {
        id: "holder-release-unpins",
        guards: "Releasing a private holder ends its pin.",
        faults: [edit("src/property-versions.js", "    deleteProperty(owner, \"value\", operationContext)\n    releasePin(owner, operationContext)\n",
            "    deleteProperty(owner, \"value\", operationContext)\n")],
        witnesses: [
            "bounded graph ownership retires queued mutation and inspection-failure graphs",
        ],
    },
    {
        id: "writers-pin-destination",
        guards: "An unfinished gate or mutation version keeps its owner alive until publication.",
        faults: [
            edit("src/ownership.js", "    meta.pinCount = (meta.pinCount ?? 0) + 1\n"),
            edit("src/ownership.js", "        releasePin(owner, operationContext)\n        owner = operationContext = undefined\n",
                "        owner = operationContext = undefined\n"),
        ],
        witnesses: [
            "bounded graph ownership preserves detached writer descendants through a cycle",
        ],
    },

    // --- Recovery -------------------------------------------------------------
    {
        id: "recovery-forces-copy",
        guards: "A value retained as a recovery baseline is copied before another owner writes it.",
        faults: [edit("src/meta.js", "if (meta?.imported || meta?.readLeaseCount || meta?.preservationParents?.size) return true",
            "if (meta?.imported || meta?.readLeaseCount) return true")],
        witnesses: [
            "preserves a failed child's baseline through COW and entry publication",
        ],
    },
    {
        id: "recovery-installs-dependency",
        guards: "Installed recovery becomes a preservation dependency of its owning placement.",
        faults: [
            edit("src/parent-placements.js", "    if (meta.relationshipsActive && version.recovery) preserveRecovery(owner, key, version.recovery, operationContext)\n"),
            edit("src/parent-placements.js", "        if (placement.recovery) preserveRecovery(owner, key, placement.recovery, operationContext)\n"),
        ],
        witnesses: [
            "bounded graph ownership restores recovery descendants before another owner can mutate them",
            "preserves a failed child's baseline through COW and entry publication",
        ],
    },
    {
        id: "recovery-release-unregisters",
        guards: "Repair, replacement, or owner retirement removes the baseline's preservation parent.",
        faults: [edit("src/parent-placements.js",
            "            keys.delete(key)\n            if (!keys.size) parents.delete(owner)\n            if (!parents.size) delete childMeta.preservationParents\n")],
        witnesses: [
            "bounded graph ownership preserves recovery introduced after a copied capture",
        ],
    },
    {
        id: "recovery-activates-baseline",
        guards: "A preserved baseline delivered or restored while inactive regains its relationships.",
        faults: [edit("src/parent-placements.js", "        children.add(value)\n        activateRelationships(value, operationContext)\n",
            "        children.add(value)\n")],
        witnesses: [
            "bounded graph ownership restores recovery descendants before another owner can mutate them",
        ],
    },

    // --- Copy-on-write and Array storage --------------------------------------
    {
        id: "second-parent-forces-copy",
        guards: "A value with two incoming placements is copied before a write through either.",
        faults: [
            edit("src/meta.js", "    visitParentPlacements(value, operationContext, () => ++count < 2)\n",
                "    visitParentPlacements(value, operationContext, () => ++count < 3)\n"),
            edit("src/meta.js", "    return count > 1\n", "    return count > 2\n"),
        ],
        witnesses: [
            "Array native equivalence matches shared-ancestor copy-on-write",
        ],
    },
    {
        id: "shared-storage-forces-copy",
        guards: "A write to a physical slot another Array owner covers copies first.",
        faults: [edit("src/array-view.js", "        let shared = false\n", "        let shared = false\n        return false\n")],
        witnesses: [
            "captured Array length knowledge preserves shared backing without a physical tail",
        ],
    },
    {
        id: "sole-owner-writes-in-place",
        guards: "An exclusive in-range view write reuses its backing (work bound, not isolation).",
        faults: [edit("src/array-view.js",
            "            if (backing.arrayBacking?.owners.size === 1 && backing.arrayBacking.owners.has(value))\n                return false\n")],
        witnesses: [
            "bounded graph ownership verifies array-point-work",
        ],
    },
    {
        id: "derivation-freezes-source-range",
        guards: "Sharing storage fixes the source's logical length so later physical growth is not exposed to it.",
        faults: [edit("src/array-view.js", "        if (!range) ArrayView.#setState(source, length, operationContext)\n")],
        witnesses: [
            "captured Array length knowledge copies before entering storage shared with another view",
        ],
    },
    {
        id: "imported-storage-not-extended",
        guards: "Imported Array storage is never extended, and is rejected before host reflection.",
        faults: [edit("src/array-view.js",
            "        if (metadata.isImported(source, operationContext) ||\n            metadata.isImported(backing, operationContext)) return\n        if (ArrayView.readyLength",
            "        if (ArrayView.readyLength")],
        witnesses: [
            "bounded graph ownership rejects imported Array storage reuse before probing extensibility",
        ],
    },
    {
        id: "validation-copies-stay-imported",
        guards: "A validation copy of an imported node keeps imported write protection.",
        faults: [edit("src/input-preparations.js",
            "        if (metadata.isImported(source, operationContext)) metadata.markImported(container.target, operationContext)\n")],
        witnesses: [
            "bounded graph ownership verifies ownership-destinations",
        ],
    },

    // --- Delivery and capture -------------------------------------------------
    {
        id: "ready-delivery-holds",
        guards: "A fresh ready output keeps a delivery lease until the next receiving command.",
        faults: [edit("src/ownership.js", "    if (delivery.empty) { delivery.release(); return }\n", "    delivery.release(); return\n")],
        witnesses: [
            "ArrayView forks retained Promise versions for each derived value",
        ],
    },
    {
        id: "ready-delivery-expires",
        guards: "The next receiving command or fallback releases earlier ready holds.",
        faults: [edit("src/ownership.js", "    if (previous) for (const delivery of previous) delivery.release()\n")],
        witnesses: [
            "toReversed finishes presence before pending element data",
        ],
    },
    {
        id: "only-source-held-lookups-skip-hold",
        guards: "Only a ready lookup still held by its source skips the delivery lease.",
        faults: [edit("src/operation-result.js",
            "delivery.capture = (value, sourceHeld = false) => sourceHeld && !issued ? value : delivery.acquire(value)",
            "delivery.capture = value => value")],
        witnesses: [
            "ArrayView forks retained Promise versions for each derived value",
        ],
    },
    {
        id: "pending-delivery-outlives-reactions",
        guards: "Pending delivery releases only after the outward Promise's direct reactions run.",
        faults: [edit("src/operation-result.js",
            "const release = () => queueMicrotask(() => releaseDetached(operationContext, delivery.release))",
            "const release = () => releaseDetached(operationContext, delivery.release)")],
        witnesses: [
            "root promises looks up through a root promise with shared ownership",
            "run imports a record method result that aliases its receiver",
        ],
    },
    {
        id: "captures-retain-published-value",
        guards: "A pending capture protects the value its version publishes.",
        faults: [edit("src/property-versions.js", "    const unsubscribe = observePlacementCapture(placement, leases.acquire)\n",
            "    const unsubscribe = () => {}\n")],
        witnesses: [
            "entry structural publication at protects an ordinary pending element before a queued mutation can use it",
        ],
    },
    {
        id: "captures-outlive-subscription",
        guards: "A capture held across a pending continuation is not released when subscription returns.",
        faults: [edit("src/property-versions.js",
            "    if (!languageValues.isPending(result, operationContext)) { complete(); return result }\n    if (operation) unregister = releaseOnClose(operation, complete)\n",
            "    complete(); if (!languageValues.isPending(result, operationContext)) return result\n")],
        witnesses: [
            "entry structural publication at protects an ordinary pending element before a queued mutation can use it",
        ],
    },
    {
        id: "resumed-writer-releases-own-capture",
        guards: "A resumed path writer releases its own capture after transfer to a live destination, before deciding to copy.",
        faults: [edit("src/property-versions.js",
            "        if (isLivePlacementVersion(owner, key, version, operationContext)) releaseCapture?.()\n")],
        witnesses: [
            "path assignment retains a Promise length payload after its object receiver resolves",
            "complete publication failures retains every failure through a pending ancestor writeback",
        ],
    },
    {
        id: "mutation-outcome-holds-receiver",
        guards: "A prepared mutation receiver stays active until publication across producer reactions.",
        faults: [edit("src/mutations.js", "    publication.acquire(mutatedValue)\n")],
        witnesses: [
            "bounded graph ownership bounds reactivation and Array extension work",
        ],
    },

    // --- Inputs and invocation ------------------------------------------------
    {
        id: "receiver-leased-before-arguments",
        guards: "The selected receiver is protected before argument preparation can wait.",
        faults: [edit("src/invocation.js", "        invocationWork.leaseReceiver(methodDescription.receiverToLease)\n")],
        witnesses: [
            "toReversed preserves earlier values while awaiting presence, later replace",
        ],
    },
    {
        id: "arguments-held-through-pending-use",
        guards: "Inputs a pending observation still reads stay leased until its result.",
        faults: [edit("src/invocation.js", "            if (!pendingInputUse) {", "            if (true) {")],
        witnesses: [
            "toReversed preserves earlier values while awaiting presence, later replace",
        ],
    },
    {
        id: "preparation-leases-existing-input",
        guards: "Already admitted input is leased while preparation walks it.",
        faults: [edit("src/input-preparations.js", "            retentions.add(value)\n            leases.acquire(value)\n",
            "            retentions.add(value)\n")],
        witnesses: [
            "bounded graph ownership bounds reactivation and Array extension work",
        ],
    },

    // --- Captured generation identity -----------------------------------------
    {
        id: "validation-copy-identity-needs-proof",
        guards: "Result validation that changes a borrowed graph must not inherit its source identity.",
        faults: [edit("src/input-preparations.js",
            "        metadata.getOrCreateMeta(container.target, operationContext, type, admittedPrototype)\n",
            "        metadata.getOrCreateMeta(container.target, operationContext, type, admittedPrototype).generation = metadata.requireMeta(source, operationContext).generation ??= {}\n")],
        witnesses: ["keeps a changed validation copy distinct from its borrowed source"],
    },
    {
        id: "materialization-preserves-identity",
        guards: "Observation representation copies keep their captured logical identity.",
        faults: [edit("src/managed-invocation.js", "    if (!mutation) metadata.requireMeta(copy, operationContext).generation = node.identity\n")],
        witnesses: ["native observation representation identity preserves identity:"],
    },
    {
        id: "length-forks-invalidate-independently",
        guards: "A private outcome cannot invalidate another Array's unchanged length frontier.",
        faults: [edit("src/array-length.js", "        const copy = new LengthState(this.baseline)\n",
            "        const copy = new LengthState(this.baseline)\n        copy.outcomes = this.outcomes\n")],
        witnesses: [
            "runtime boundary completion answers Array range and length questions without scanning unrelated fork outcomes",
            "bounded graph ownership bounds reactivation and Array extension work",
        ],
    },
    {
        id: "retired-length-sequences-unsubscribe",
        guards: "Discarded Array sequences leave pending source registries, bounding notification work to live dependencies.",
        faults: [edit("src/array-length.js",
            "        for (let node = this.head; node; node = node.next)\n            node.source?.consumers.delete(this.outcomes)\n")],
        witnesses: ["bounded graph ownership bounds reactivation and Array extension work"],
    },
    {
        id: "captures-use-generation-tokens",
        guards: "Identity consumers key by captured generation, not by address.",
        faults: [edit("src/captured-identity.js", "meta.generation ??= {} : value", "value : value")],
        witnesses: [
            // Distinct consequence: cyclic cross-owner exports preserve aliases
            // while searches distinguish captured old and new child generations.
            "ownership isolation across pending work preserves cyclic aliases and captured search generations across both owners",
            "bounded graph ownership distinguishes export generations when a mutable entry installs its gate",
            "cross-boundary histories preserves cached graph generations, aliases, and ordered effects across readiness schedules",
        ],
    },
    {
        id: "path-writes-advance-generation",
        guards: "Each mutation-path container gets a new generation before its view is exposed.",
        faults: [edit("src/mutations.js", "            advanceIdentity(parent, operationContext, advancedIdentities ??= new WeakSet())\n")],
        witnesses: [
            "bounded graph ownership distinguishes exported generations before a pending mutation reaches its target",
        ],
    },
    {
        id: "gates-advance-generation",
        guards: "Installing a gate gives its owner a new generation.",
        faults: [edit("src/property-versions.js", "    const releaseWriter = retainWriter(owner, operationContext)\n    advanceIdentity(owner, operationContext)\n",
            "    const releaseWriter = retainWriter(owner, operationContext)\n")],
        witnesses: [
            "bounded graph ownership distinguishes export generations when a mutable entry installs its gate",
        ],
    },
    {
        id: "generation-advance-reaches-ancestors",
        guards: "A new generation also advances every ancestor, including above a nested entry gate.",
        faults: [edit("src/captured-identity.js", "        advanceIdentity(parent, operationContext, visited)\n")],
        witnesses: [
            "bounded graph ownership advances every ancestor generation when a nested entry installs its gate",
        ],
    },
]
