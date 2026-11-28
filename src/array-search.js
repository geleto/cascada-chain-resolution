import { ArrayView } from "./array-view.js"
import { captureLayout, layoutAt, layoutCause, MAX_ARRAY_LENGTH, restrict, searchRuns, skippedCause, span } from "./array-layout.js"
import { captureIdentity, compareIdentities } from "./captured-identity.js"
import { combineErrors, isPoisonError } from "./error.js"
import { continueGraphTransition, decideInputs } from "./internal-step.js"
import { isNumericPrimitive, toIntegerOrInfinity } from "./language-conversion.js"
import { enumerableLanguageKeyCandidates, readLanguagePlacement } from "./language-properties.js"
import { isPending } from "./language-values.js"
import { consumePlacementTransition, placementValue, resolveVisiblePlacement, structuralFailure } from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { runArrayStep } from "./array-methods.js"
import { unorderedOccurrences } from "./array-occurrences.js"
import { captureOrder, captureSkippedRange } from "./array-sequence.js"

// Range and comparison are independent. Request each argument at most once,
// and capture any still-possible input before a search suspends.
function prepareSearch(work) {
    const ctx = work.operationContext, backwards = work.method === "lastIndexOf"
    let args = work.args, needle, bound
    let hasNeedle = false, hasBound = false
    const inputs = {
        simpleBound: isNumericPrimitive(args[1]),
        // A ready comparison can exclude its position without consuming an
        // expensive bound. If the needle also needs preparation, try range first.
        prepareRangeFirst: args[0] !== null && (typeof args[0] === "object" || typeof args[0] === "function"),
        unrestricted: args.length < 2 || args[1] == null || args[1] === 0 || args[1] === -Infinity,
        needle() {
            if (hasNeedle) return needle
            hasNeedle = true
            needle = continueGraphTransition(work.prepareArgument(0, args), ctx,
                value => isPoisonError(value) ? value : captureIdentity(value, ctx), undefined, work)
            work.releaseArgument(0)
            if (args.length) args[0] = undefined
            return needle
        },
        bound() {
            if (hasBound) return bound
            hasBound = true
            if (args.length < 2) return bound = backwards ? Infinity : 0
            const number = toIntegerOrInfinity(work.prepareArgument(1, args), work)
            args[1] = undefined
            work.releaseArgument(1)
            const relative = isPending(number, ctx) || typeof number === "number" && number < 0
            const shape = relative && (work.arrayLength ?? ArrayView.captureLength(work.receiver, ctx, work))
            const maximum = relative && (work.arrayLength ?? ArrayView.maximumLength(work.receiver, ctx))
            bound = continueGraphTransition(number, ctx, index => {
                if (isPoisonError(index) || index >= 0) { shape?.release?.(); return index }
                if (backwards ? index < -maximum : index <= -maximum) { shape?.release?.(); return backwards ? -1 : 0 }
                return continueGraphTransition(shape.read ? shape.read() : shape, ctx,
                    length => backwards ? length + index : Math.max(0, length + index), undefined, work)
            }, undefined, work)
            if (isPending(bound, ctx)) markPromiseHandled(continueGraphTransition(bound, ctx,
                value => { bound = value }, undefined, work), ctx)
            return bound
        },
    }
    work.discardPreparedOutput = () => { args = needle = bound = undefined }
    if (work.receiverCapture) work.prepareArgumentFrontier(2, args)
    return inputs
}

// Either negative proof discharges the other operand, including its failure.
// A required failure remains conditional until the other operand settles.
function conjunction(left, right, work) {
    if (left === false || right === false) return false
    if (left === true) return right
    if (right === true) return left
    const ctx = work.operationContext
    return decideInputs([left, right], ctx, ([a, b], value, remaining) => {
        if (value === false) return false
        if (!remaining) return isPoisonError(a) && isPoisonError(b) ? combineErrors([a, b]) : isPoisonError(a) ? a : b
    }, work)
}

// Locate a compact range in the already determined portion of an
// open sequence. A right operand needs an exact offset. A capacity boundary
// leaves its virtual cause to ordinary point selection.
function openSearchRange(part, index, backwards, prefix) {
    let at = index, count = backwards ? index - prefix + 1 : Number.MAX_SAFE_INTEGER - index
    while (part && count > 0) {
        if (part.capacityInput) {
            if (at >= MAX_ARRAY_LENGTH) return
            if (!backwards) count = Math.min(count, MAX_ARRAY_LENGTH - at)
            part = part.capacityInput
            continue
        }
        const node = part.node ?? part.head
        if (at < node.length) {
            const start = backwards ? Math.max(0, at + 1 - count) : at
            const end = backwards ? at + 1 : Math.min(node.length, at + count)
            return { node: restrict(node, start, end), first: index + (start - at) }
        }
        if (!part.parts) { part = part.current; continue }
        const [left, right] = part.parts
        if (at < left.minimum) {
            if (!backwards) count = Math.min(count, left.minimum - at)
            part = left
        } else {
            if (left.minimum !== left.maximum) return
            at -= left.minimum
            part = right
        }
    }
}

function search(inputs, work) {
    const ctx = work.operationContext, any = work.method === "includes", backwards = work.method === "lastIndexOf"
    const miss = any ? false : -1
    let source = work.receiver, awaiting = false
    let occurrences = any && unorderedOccurrences(source, ctx, () => {
        if (awaiting) { awaiting = false; scan() }
    }, inputs.unrestricted)
    const region = ArrayView.region(source, ctx), length = ArrayView.readyLength(source, ctx)
    let order = !any && region?.pending && captureOrder(source, ctx)
    const prefix = ArrayView.prefixLength(source, ctx)
    // An ordinary Array and a sparse borrowed prefix share a stored-key scan.
    // When the prefix ends, resume at the first position in the suffix.
    const physicalEnd = !region ? length : ArrayView.hasSparsePrefix(source, prefix, ctx) ? prefix : 0
    let index = 0, end, keys, runs, resumeIndex, searched, keyIndex = 0, remaining = 1, errors, result, deferred, unavailable
    let inspectionFailure
    const transition = (value, next) => continueGraphTransition(value, ctx, next, undefined, work)
    const maximum = length ?? ArrayView.maximumLength(source, ctx)
    if (!maximum) return miss
    let bound
    if (inputs.simpleBound || backwards && length === undefined ||
        inputs.prepareRangeFirst && (any || region || ArrayView.storedIndexes(source, ctx) ||
            ArrayView.hasStoredVersions(source, ctx))) bound = inputs.bound()
    const excludesAll = start => typeof start === "number" && (backwards ? start < 0 : start >= maximum)
    if (excludesAll(bound)) { releaseSource(); return miss }
    if (backwards) index = Math.min(maximum - 1, typeof bound === "number" ? bound : Infinity)
    else if (typeof bound === "number") index = bound
    scan()
    if (result !== undefined) return result
    bound = inputs.bound()
    if (excludesAll(bound)) { releaseSource(); return miss }
    deferred = Promise.withResolvers()
    if (isPending(bound, ctx)) markPromiseHandled(transition(bound, start => {
        bound = start
        if (excludesAll(start)) finish(miss)
    }), ctx)
    inputs.needle()
    return deferred.promise

    function compare(placement) {
        return consumePlacementTransition(placement, ctx, selected => {
            if (!any && selected.present === false) return false
            const failure = structuralFailure(selected)
            if (failure) return failure
            const needle = inputs.needle()
            return resolveVisiblePlacement(selected, ctx, ready => {
                const identity = captureIdentity(ready.value, ctx)
                return transition(needle, value => isPoisonError(value) ? value :
                    compareIdentities(identity, value, work, any))
            })
        }, work)
    }

    function eligible(low, high, position, within) {
        bound = inputs.bound()
        return transition(bound, start => {
            if (isPoisonError(start)) return start
            if (backwards ? high <= start : low >= start) return true
            if (backwards ? low > start : high < start) return false
            if (within) return within(start)
            return transition(position(), i => backwards ? i <= start : i >= start)
        })
    }

    function candidate(low, high, position, read, within) {
        if (typeof bound === "number" && (backwards ? low > bound : high < bound)) return false
        const placement = read()
        const evaluate = () => {
            const matches = transition(placement, compare)
            return matches === false ? false : conjunction(eligible(low, high, position, within), matches, work)
        }
        // A ready match ends includes immediately. Capture the other
        // placements now, and subscribe only if this sweep needs their answers.
        if (any && (isPending(placement, ctx) || placement.transition || isPending(placementValue(placement), ctx))) {
            ;(unavailable ??= []).push(evaluate)
            return false
        }
        return evaluate()
    }

    function structuralRun(node, first, last = first, position) {
        const causes = (low = 0, high = node.length) => node.ready ?
            transition(captureSkippedRange(node, low, high, ctx), range => skippedCause(range, ctx)) :
            layoutCause(restrict(node, low, high), ctx)
        return transition(inputs.bound(), bound => {
            if (isPoisonError(bound)) return transition(causes(), cause => combineErrors([bound, cause]))
            if (any && bound <= first) return causes()
            if (!backwards && bound - last >= node.length) return false
            return first === last ? select(first) : transition(position(), select)
            function select(start) {
                const low = backwards ? 0 : Math.max(0, bound - start)
                const high = backwards ? Math.min(node.length, bound - start + 1) : node.length
                if (low >= high) return false
                return any ? causes(low, high) :
                    structuralFailure(layoutAt(node, backwards ? high - 1 : low))
            }
        })
    }

    function anyCandidate(comparison) {
        if (comparison === true) return true
        if (isPending(comparison, ctx)) {
            remaining++
            markPromiseHandled(transition(comparison, accept), ctx)
        } else if (isPoisonError(comparison)) (errors ??= new Set()).add(comparison)
        return false
    }

    function searchGroup(item) {
        // Positions increase within a run, even across an unresolved splice.
        // With a partial bound, the last copy of each value or cause decides
        // its eligibility. A wholly eligible group can collect causes at once.
        const all = typeof bound === "number" && bound <= item.low
        for (const { node, first } of searchRuns(item.group, 0, !all, new Set(), all)) {
            if (item.markers && !node.errors) continue
            const offset = first + node.length - 1
            const comparison = all && node.errors === node.length ? layoutCause(node, ctx) :
                candidate(item.low + offset, item.high + offset, () => item.position(offset),
                    () => node.placement ?? { present: false, value: undefined },
                    item.eligible && (start => item.eligible(start, offset, work)))
            if (anyCandidate(comparison)) return true
        }
    }

    function* sparseRuns(first, stop) {
        const candidates = enumerableLanguageKeyCandidates(source, ctx, first, stop, undefined, false, true)
        for (const key of candidates) {
            const at = Number(key)
            if (first < at) yield { first, node: span(at - first) }
            yield { first: at, point: true }
            first = at + 1
        }
        if (first < stop) yield { first, node: span(stop - first) }
    }

    function scanLayout(node, first) {
        const eligible = typeof bound === "number" && (backwards ? first + node.length - 1 <= bound : first >= bound)
        return searchRuns(node, first, backwards || any && !eligible,
            eligible ? searched ??= new WeakSet() : any ? new WeakSet() : undefined)
    }

    function scan() {
        let inspecting
        const readPoint = at => {
            inspecting = at
            const placement = readLanguagePlacement(source, at, ctx)
            inspecting = undefined
            return placement
        }
        const failed = runArrayStep(work, () => {
            for (;;) {
                let current, comparison, location
                if (occurrences) {
                    const item = occurrences.next(0, Number.MAX_SAFE_INTEGER, true)
                    if (!item) {
                        if (occurrences.done(typeof bound === "number" ? bound : 0)) break
                        if (checkUnavailable()) return finish(true)
                        awaiting = true
                        return
                    }
                    if (item.group) {
                        if (searchGroup(item)) return finish(true)
                        continue
                    }
                    comparison = item.capturedMarkers ? structuralRun(item.capturedMarkers, item.low, item.high, item.position) :
                        candidate(item.low, item.high, item.position, item.read,
                            item.eligible && (start => item.eligible(start, 0, work)))
                } else {
                    if (end === undefined) {
                        end = ArrayView.readyLength(source, ctx)
                        const limit = end ?? ArrayView.minimumLength(source, ctx)
                        if (backwards && index >= limit || !backwards && index >= limit && end === undefined) {
                            const at = index
                            let waiting = true
                            if (backwards) {
                                const narrowed = inputs.bound()
                                if (typeof narrowed === "number" && narrowed < at) { index = narrowed; continue }
                                if (isPending(narrowed, ctx)) markPromiseHandled(transition(narrowed, start => {
                                    if (waiting && typeof start === "number" && start < at) {
                                        waiting = false
                                        index = start
                                        scan()
                                    }
                                }), ctx)
                            }
                            const wait = ArrayView.resolveInRange(source, at, work, present => {
                                if (!waiting) return
                                waiting = false
                                if (!present && !backwards) return exhausted()
                                if (!present) index = Math.min(index, ArrayView.maximumLength(source, ctx) - 1)
                                return scan()
                            })
                            markPromiseHandled(wait, ctx)
                            if (checkUnavailable()) return finish(true)
                            return
                        }
                        // Directional searches can skip an entire sparse hole range.
                        if (end !== undefined && ArrayView.region(source, ctx)?.layout) {
                            const first = backwards ? 0 : Math.min(index, end)
                            const last = backwards ? Math.max(0, index + 1) : end
                            runs = scanLayout(captureLayout(source, ctx, end, first, last), first)
                            resumeIndex = undefined
                        }
                    }
                    if (!keys && !runs) {
                        if (!any && index >= 0 && index < physicalEnd) {
                            keys = Array.from(enumerableLanguageKeyCandidates(source, ctx,
                                backwards ? 0 : index, backwards ? index + 1 : physicalEnd), Number)
                            if (backwards) keys.reverse()
                            keyIndex = 0
                            resumeIndex = !backwards && end !== physicalEnd ? physicalEnd : undefined
                        } else if (order && index >= prefix && index < (end ?? ArrayView.minimumLength(source, ctx))) {
                            const chunk = openSearchRange(order, index, backwards, prefix)
                            if (chunk) {
                                resumeIndex = backwards ? chunk.first - 1 : chunk.first + chunk.node.length
                                runs = scanLayout(chunk.node, chunk.first)
                            }
                        }
                    }
                    const run = runs?.next().value
                    if (runs && !run || keys && keyIndex === keys.length) {
                        if (resumeIndex === undefined) break
                        index = resumeIndex
                        runs = keys = resumeIndex = undefined
                        continue
                    }
                    if (run && !run.point) {
                        const { node, first } = run, last = first + node.length - 1
                        current = backwards ? first : last
                        index = backwards ? first - 1 : last + 1
                        comparison = node.errors === node.length ? structuralRun(node, first) :
                            candidate(current, current, () => current,
                                () => node.placement ?? { present: false, value: undefined })
                        if (!any) location = () => transition(inputs.bound(), from =>
                            backwards ? Math.min(last, from) : Math.max(first, from))
                    } else if (run) {
                        current = run.first
                        index = current + 1
                    } else if (keys) current = keys[keyIndex++]
                    else {
                        if (backwards ? index < 0 : index >= (end ?? ArrayView.minimumLength(source, ctx))) break
                        current = index
                        index += backwards ? -1 : 1
                    }
                    if (!run || run.point) {
                        comparison = candidate(current, current, () => current, () => readPoint(current))
                        if (any && !run && index < physicalEnd) {
                            runs = sparseRuns(index, physicalEnd)
                            resumeIndex = end !== physicalEnd ? physicalEnd : undefined
                        }
                    }
                }
                if (any) {
                    if (anyCandidate(comparison)) return finish(true)
                } else if (isPending(comparison, ctx)) {
                    const last = keys ? keyIndex === keys.length && resumeIndex === undefined : backwards ? index < 0 : index === end
                    if (last) releaseSource()
                    markPromiseHandled(transition(comparison, equal => {
                        if (equal) finish(isPoisonError(equal) ? equal : location ? location() : current)
                        else if (last) finish(miss)
                        else scan()
                    }), ctx)
                    return
                } else if (comparison === true) return finish(location ? location() : current)
                else if (isPoisonError(comparison)) return finish(comparison)
            }
            if (checkUnavailable()) return finish(true)
            exhausted()
        })
        if (isPoisonError(failed)) {
            // Inspection of a possible candidate can fail before its range is
            // known. Preserve that failure only if the search reaches it.
            const required = inspecting === undefined ? transition(inputs.bound(), from => !excludesAll(from)) :
                eligible(inspecting, inspecting, () => inspecting)
            markPromiseHandled(transition(required, needed => {
                if (!needed) {
                    if (inspecting === undefined || excludesAll(inputs.bound())) finish(miss)
                    else scan()
                    return
                }
                inspectionFailure = isPoisonError(needed) ? combineErrors([needed, failed]) : failed
                if (!any) return finish(inspectionFailure)
                // An earlier match would have stopped the all-ready scan
                // before this failed inspection. Only those comparisons remain.
                if (checkUnavailable()) finish(true)
                else exhausted()
            }), ctx)
        }
    }

    function checkUnavailable() {
        const pending = unavailable
        unavailable = undefined
        return pending?.some(evaluate => anyCandidate(evaluate()))
    }
    function releaseSource() {
        if (occurrences) occurrences.close()
        source = occurrences = order = keys = undefined
        runs = searched = unavailable = undefined
        work.releaseReceiverLeases()
    }
    function exhausted() {
        releaseSource()
        if (any) accept(false)
        else finish(miss)
    }
    function accept(equal) {
        if (result !== undefined) return
        if (equal === true) return finish(true)
        if (isPoisonError(equal)) (errors ??= new Set()).add(equal)
        if (!--remaining) finish(inspectionFailure ?? (errors ? combineErrors(errors) : false))
    }
    function finish(value) {
        releaseSource()
        result = value
        errors = undefined
        if (deferred) { work.close(); deferred.resolve(value) }
    }
}

export { prepareSearch, search }
