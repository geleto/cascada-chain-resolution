// Runtime safeguard witness registry. Each entry removes one safeguard with an
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
        id: "terminal-search-source-release",
        guards: "Ordered searches release consumed receiver storage while a terminal comparison remains pending.",
        faults: [edit("src/array-methods.js", "if (backwards ? index === -1 : index === length) {", "if (false) {")],
        witnesses: ["releases completed captures while returned Errors remain unformatted"],
    },
    {
        id: "failed-conversion-shape-release",
        guards: "A failed conversion drops its success-only length question before required Error collection finishes.",
        faults: [edit("src/language-conversion.js", "if (errorUtils.isPoisonError(value)) shape.length?.release?.()")],
        witnesses: ["releases failed join shape before Error collection finishes:"],
    },
    {
        id: "external-failure-captures-ancestors",
        guards: "A failed managed prefix on an external mutation separates each ancestor identity.",
        faults: [edit("src/mutations.js", "if (observeTarget) {\n                    prepareParent()\n                    if (index > 0) publication.capture(parent)",
            "if (observeTarget) {\n                    prepareParent()")],
        witnesses: ["separates ancestors when external selection writes back failure:"],
    },
    {
        id: "delivered-length-question-release",
        guards: "Delivered length questions unregister from a still-open owner's release registry.",
        faults: [edit("src/array-length.js", "answer = value\n            release()", "answer = value")],
        witnesses: ["unregisters delivered length questions while their owner remains open"],
    },
    {
        id: "captured-shape-completion",
        guards: "Deleted pending placements can leave independent growth; captured output waits for its own prefix.",
        faults: [edit("src/array-length.js", "read: () => answer ?? promise", "read: () => answer ?? 0")],
        witnesses: ["finishes deleted growth independently:"],
    },
    {
        id: "nonwriting-array-ancestor-identity",
        guards: "Nested Array no-ops preserve every affected ancestor identity.",
        faults: [edit("src/array-invocation.js", "invocationWork.retainOutput(invocationWork.receiver), operationContext, false)",
            "invocationWork.retainOutput(invocationWork.receiver), operationContext, true)")],
        witnesses: ["preserves ancestor identity for nested nonwriting"],
    },
    {
        id: "pending-cycle-comparison",
        guards: "A pending same-lineage comparison is not a proved Array cycle.",
        faults: [edit("src/array-view.js", "if (languageValues.isPending(equal, operation.operationContext)) {",
            "if (!languageValues.isPending(equal, operation.operationContext)) {")],
        witnesses: ["resolves same-lineage cycle checks"],
    },
    {
        id: "closed-comparison-detaches-both-endpoints",
        guards: "A closed comparison is removed from each pending endpoint, without waiting for publication.",
        faults: [edit("src/captured-identity.js", "this.left?.queries?.delete(this)")],
        witnesses: ["bounded graph ownership verifies identity-work"],
    },
    {
        id: "completed-publication-adoption",
        guards: "Adoption retains an outcome that completed after it was captured but before it was recorded.",
        faults: [edit("src/captured-identity.js", "this.published ||= published.published", "this.published &&= published.published")],
        witnesses: ["bounded graph ownership verifies identity-work"],
    },
    {
        id: "entry-discovery-private-anchor",
        guards: "Optional discovery fallback excludes its private anchor from public ancestor futures.",
        faults: [edit("src/enter.js", "if (publication) publication.captures.length = capturedAncestors")],
        witnesses: ["keeps entry usable after each fallible discovery read"],
    },
    {
        id: "failed-gated-noop-is-effective",
        guards: "A no-op producer whose gated publication commits poison is an effective command.",
        faults: [edit("src/mutations.js", "if (!restoring) published = true", "if (!restoring) published = false")],
        witnesses: ["counts failed gated no-op publication as an identity write"],
    },
    {
        id: "failed-entry-publication-is-effective",
        guards: "Entry completion that fails to publish its value separates ancestor identity.",
        faults: [edit("src/property-versions.js", "gate.publication.published = true")],
        witnesses: ["counts failed entry completion as an identity write"],
    },
    {
        id: "existing-poison-blocks-publication",
        guards: "Consuming already-poisoned scope data publishes nothing.",
        faults: [edit("src/mutations.js", "placement: baseline, published: false", "placement: baseline, published: true")],
        witnesses: ["preserves identity when existing poison blocks"],
    },
    {
        id: "entry-structure-shares-preparation",
        guards: "Nested holders reuse structural preparation without a recursive history walk at each completion.",
        faults: [edit("src/placement-structure.js", "if (enclosing) return { prepare: enclosing.prepare }",
            "if (enclosing) return { prepare(placement) { return enclosing.prepare(placement) } }")],
        witnesses: ["bounded graph ownership verifies entry-history-work"],
    },
    {
        id: "entry-structure-completion-owner",
        guards: "Completing a nested holder cannot finish its enclosing placement's growth reservation.",
        faults: [edit("src/placement-structure.js", "if (enclosing) return { prepare: enclosing.prepare }",
            "if (enclosing) return { prepare: enclosing.prepare, complete: enclosing.complete }")],
        witnesses: ["keeps the enclosing growth reservation after a nested empty entry"],
    },
    {
        id: "entry-storage-walk-is-iterative",
        guards: "Required write-through across deep entry history does not consume the JavaScript stack.",
        faults: [
            edit("src/property-versions.js", "const destinations = []\n    for (;;) {",
                "const destinations = []\n    function visit(owner, key) {"),
            edit("src/property-versions.js", "if (!gate || !isLivePlacementVersion(gate.owner, gate.key, gate.version, operationContext)) break",
                "if (!gate || !isLivePlacementVersion(gate.owner, gate.key, gate.version, operationContext)) return"),
            edit("src/property-versions.js", "key = gate.key\n    }\n    const absent",
                "key = gate.key\n        visit(owner, key)\n    }\n    visit(owner, key)\n    const absent"),
        ],
        witnesses: ["bounded graph ownership verifies entry-history-work"],
    },
    {
        id: "observation-releases-source-owner",
        guards: "Captured observations release their source Chain while required work remains pending.",
        faults: [edit("src/path-operation.js", "        this.chain = undefined\n        const boundary",
            "        const boundary")],
        witnesses: ["runtime boundary completion releases completed captures while returned Errors remain unformatted"],
    },
    {
        id: "lookup-releases-root-capture",
        guards: "Pending lookup callbacks retain exact versions rather than the spent root holder.",
        faults: [edit("src/path-operation.js", "finally { rootState = chain = undefined }", "finally {}")],
        witnesses: ["runtime boundary completion releases completed captures while returned Errors remain unformatted"],
    },
    {
        id: "publication-releases-source-owner",
        guards: "An independent removed-value result cannot retain the source Chain after mutation publication.",
        faults: [edit("src/path-operation.js", "            this.chain = undefined\n            this.completeExternalEffect()",
            "            this.completeExternalEffect()")],
        witnesses: ["runtime boundary completion releases completed captures while returned Errors remain unformatted"],
    },
    {
        id: "managed-capture-releases-source",
        guards: "Completed receiver capture releases original sources while arguments or receiver properties remain pending.",
        faults: [edit("src/managed-invocation.js", "    work.releaseReceiverLeases()\n")],
        witnesses: ["runtime boundary completion releases completed captures while returned Errors remain unformatted"],
    },
    {
        id: "managed-preparation-discards-all-output",
        guards: "Receiver failure releases successful argument records while required Error collection remains pending.",
        faults: [edit("src/managed-invocation.js",
            "        capture.discard()\n        argumentsCapture.discard()",
            "        capture.discard()")],
        witnesses: ["runtime boundary completion releases completed captures while returned Errors remain unformatted"],
    },
    {
        id: "managed-preparation-joins-capture-before-identity",
        guards: "A receiver Error skips argument identity waits and successful output while required Error collection continues.",
        faults: [edit("src/managed-invocation.js", "[receiverReady, argumentsReady]", "[argumentsReady]")],
        witnesses: ["managed receiver capture finishes failed joint preparation without argument identity"],
    },
    {
        id: "leased-input-restores-relationships",
        guards: "A lease on a retired cached graph restores its borrowed descendants' protection before later work.",
        faults: [edit("src/meta.js", "    activateRelationships(value, operationContext)\n    meta.readLeaseCount",
            "    meta.readLeaseCount")],
        witnesses: ["bounded graph ownership restores a leased cached argument"],
    },
    {
        id: "bounded-array-candidates-stream",
        guards: "Capturing a bounded sparse range allocates no candidate key per hole.",
        faults: [edit("src/array-view.js", "return indexKeys(start - offset, end - offset)",
            "const keys = []; for (let index = start; index < end; index++) keys.push(String(index - offset)); return keys")],
        witnesses: ["bounded graph ownership verifies array-enumeration-work"],
    },
    {
        id: "array-overlay-merge-streams",
        guards: "Merging captured overlays does not eagerly expand a bounded sparse range.",
        faults: [edit("src/language-properties.js", "if (array) return mergeArrayKeys(keys, Object.keys(versions).filter(",
            "if (array) return mergeArrayKeys([...keys], Object.keys(versions).filter(")],
        witnesses: ["bounded graph ownership verifies array-enumeration-work"],
    },
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
    {
        id: "gate-pin-after-preparation",
        guards: "Failed gate preparation acquires no writer ownership and cannot prevent retirement.",
        faults: [edit("src/property-versions.js",
            "    const structure = beginPlacementStructure(owner, key, captured, operationContext)\n    const releaseWriter = retainWriter(owner, operationContext)\n    const previous = capturedVersion",
            "    const releaseWriter = retainWriter(owner, operationContext)\n    const structure = beginPlacementStructure(owner, key, captured, operationContext)\n    const previous = capturedVersion")],
        witnesses: ["bounded graph ownership retires Arrays and cyclic descendants after failed entry preparation"],
    },
    {
        id: "mutation-version-pin-after-preparation",
        guards: "Failed queued-mutation preparation acquires no writer ownership and cannot prevent retirement.",
        faults: [edit("src/property-versions.js",
            "    const structure = beginPlacementStructure(owner, key, captured, operationContext)\n    const releaseWriter = retainWriter(owner, operationContext)\n    installPlacementVersion(owner, key, version, operationContext)",
            "    const releaseWriter = retainWriter(owner, operationContext)\n    const structure = beginPlacementStructure(owner, key, captured, operationContext)\n    installPlacementVersion(owner, key, version, operationContext)")],
        witnesses: ["bounded graph ownership retires Arrays and cyclic descendants after failed queued mutation preparation"],
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
        faults: [edit("src/managed-invocation.js", "                    if (!mutation) metadata.requireMeta(copy, invocationWork.operationContext).generation = node.identity\n")],
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
        faults: [edit("src/captured-identity.js", "return meta.generation ??= fresh()", "return value")],
        witnesses: [
            // Distinct consequence: cyclic cross-owner exports preserve aliases
            // while searches distinguish captured old and new child generations.
            "ownership isolation across pending work preserves cyclic aliases and captured search generations across both owners",
            "bounded graph ownership distinguishes export generations after an effective entry",
            "cross-boundary histories preserves cached graph generations, aliases, and ordered effects across readiness schedules",
        ],
    },
    {
        id: "path-writes-advance-generation",
        guards: "Mutation captures affected path occurrences before exposing their unfinished views.",
        faults: [edit("src/mutations.js", "            if (index > 0) publication.capture(parent)\n")],
        witnesses: [
            "bounded graph ownership distinguishes exported generations before a pending mutation reaches its target",
        ],
    },
    {
        id: "entry-reserves-future-identity",
        guards: "Entry exposes a pending future before its callback can publish.",
        faults: [edit("src/enter.js", "            publication.suspend()\n")],
        witnesses: [
            "bounded graph ownership distinguishes a retained generation from an unfinished effective entry in includes, ordered=false",
            "bounded graph ownership keeps before/after entry export captures distinct until delayed effects finish",
        ],
    },
    {
        id: "entry-captures-ancestor-identity",
        guards: "Entry captures every reached ancestor before selecting its placement.",
        faults: [edit("src/enter.js", "                publication?.capture(value)\n")],
        witnesses: [
            "bounded graph ownership advances affected ancestor identities for a nested entry publication",
        ],
    },
    {
        id: "nonpublication-forwards-identity",
        guards: "A completed nonpublishing command preserves its predecessor identity.",
        faults: [edit("src/captured-identity.js", "current.published ? undefined : capture.before", "undefined")],
        witnesses: ["entry identity conformance N1 preserves identity after empty entry: ready, export"],
    },
    {
        id: "capture-completes-removed-presence-identity",
        guards: "Ready remap contents do not prove identity while removed destination presence is undecided.",
        faults: [edit("src/captured-identity.js", "waits.push(compareIdentities(first, node.identity, owner))", "undefined")],
        witnesses: ["write-based identity conformance removal of undecided presence keeps value access independent: create=false, nested=false"],
    },
    {
        id: "nested-publication-registers-before-close",
        guards: "An independently returned nested entry contributes to enclosing identity before its outcome is known.",
        faults: [edit("src/captured-identity.js", "        if (enclosing) enclosing.remaining++\n")],
        witnesses: ["write-based identity conformance keeps enclosing identity pending for an independently returned nested entry: publishes=true"],
    },
    {
        id: "deletion-uses-settled-presence",
        guards: "A pending placement gate does not establish that deletion publishes a write.",
        faults: [edit("src/mutations.js", "target.publication.addPending(presence)", "target.publication.record(true)")],
        witnesses: ["publication partitions across command sequences models writes: Array=false, present=false, imported=false, nested=false"],
    },
    {
        id: "primitive-search-does-not-wait-for-identity",
        guards: "Available primitive/object comparisons are unequal before object publication completes.",
        faults: [edit("src/captured-identity.js", "    if (left === null || right === null || typeof left !== \"object\" || typeof right !== \"object\") return false\n")],
        witnesses: ["identity completion at managed publication decides available primitive searches: indexOf, backwards=false, matched=true"],
    },
    {
        id: "native-result-does-not-extend-managed-publication",
        guards: "Managed selection completes before a native call can hold its independent result open.",
        faults: [edit("src/path-operation.js",
            "value => ({ mutatedValue: value, result: undefined })",
            "value => steps.continueGraphTransition(this.reachExternal(value, this.route.path.slice(depth), onExternal), this.operationContext, () => ({ mutatedValue: value, result: undefined }))")],
        witnesses: ["identity completion at managed publication separates native result delivery: mutation=true, never, write=false"],
    },
    {
        id: "deletion-does-not-gate-unrelated-values",
        guards: "Only the deletion identity decision depends on preceding presence.",
        faults: [edit("src/mutations.js",
            "                propertyVersions.deleteProperty(target.parent, target.key, operationContext)\n                if (languageValues.isPending(presence, operationContext)) target.publication.addPending(presence)\n                else target.publication.record(presence)",
            "                return internalSteps.continueGraphTransition(presence, operationContext, present => { propertyVersions.deleteProperty(target.parent, target.key, operationContext); target.publication.record(present) })")],
        witnesses: ["deletion value progress releases the scope while identity presence is pending: present=true, nested=false"],
    },
    {
        id: "deletion-shortcut-requires-final-target",
        guards: "An absent mutation scope is still a broken prefix when deletion targets a descendant.",
        faults: [edit("src/path-operation.js", "deletesTarget: deleting && replaceScope", "deletesTarget: deleting")],
        witnesses: ["scope placement and record order does not treat an absent deletion prefix as its target: pending=false, nested=false, scope=2"],
    },
    {
        id: "nested-assignment-uses-destination-order",
        guards: "A replacement carries its ordered predecessor's presence and insertion position, not a copied physical slot.",
        faults: [edit("src/mutations.js", "transferPlacement({ ...resolved, position },", "transferPlacement(resolved,")],
        witnesses: ["scope placement and record order preserves insertion order after an entered key: imported=false, nested=false, scope=0, delete"],
    },
    {
        id: "external-entry-finishes-managed-identity",
        guards: "Selecting an external entry completes its nonpublishing managed contribution.",
        faults: [edit("src/enter.js", "                publication?.finish(false)\n")],
        witnesses: ["finishes managed identity after an external-scope entry:"],
    },
    {
        id: "copied-completed-absence-is-not-a-write",
        guards: "A copied gate can resolve absence synchronously before its value delivery advances the copy.",
        faults: [edit("src/mutations.js", "else target.publication.record(presence)", "else target.publication.record(true)")],
        witnesses: ["deletes an absent completed transition before copied value delivery:"],
    },
    {
        id: "repair-preserves-failed-prefix",
        guards: "Repair selection failure returns its Error without poisoning healthy data.",
        faults: [edit("src/mutations.js", "        if (preserveOnFailure) return failure\n")],
        witnesses: ["failed repair preserves healthy data:"],
    },
    {
        id: "lineage-rejects-unrelated-identities",
        guards: "Unrelated identity lineages never require publication completion to compare unequal.",
        faults: [edit("src/captured-identity.js", "    if (left.lineage !== right.lineage) return false\n")],
        witnesses: ["identity lineage completion rejects unrelated identities"],
    },
    {
        id: "captured-partition-can-merge-before-settlement",
        guards: "Assembly finishes when its captured keys merge, even while their common outcome remains pending.",
        faults: [edit("src/captured-identity.js", "compareIdentities(first, node.identity, owner)",
            "waitIdentities(node.identity, undefined, owner)")],
        witnesses: ["finishes a captured partition when its keys merge into an unfinished predecessor"],
    },
    {
        id: "deferred-assignment-keeps-publication-boundary",
        guards: "Supported publication failure after key-order readiness remains recoverable at the selected scope.",
        faults: [edit("src/mutations.js",
            "const result = errorUtils.catchExternalThrow(\n                                        () => propertyVersions.transferPlacement({ ...resolved, position },\n                                            target.parent, target.key, operationContext),\n                                        operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)",
            "const result = propertyVersions.transferPlacement({ ...resolved, position }, target.parent, target.key, operationContext)")],
        witnesses: ["preserves scoped failure after waiting for key order:"],
    },

]
