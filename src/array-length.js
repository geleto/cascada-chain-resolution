import * as metadata from "./meta.js"
import { publishedArrayLength } from "./array-view.js"
import { continueOperation } from "./internal-step.js"
import { releaseOnClose } from "./operation-lifecycle.js"

// Contributions and questions share program order. A source outcome can feed
// several captured sequences, but later additions belong to only one sequence.
class LengthState {
    constructor(baseline, outcomes = { revision: 0 }) {
        this.baseline = baseline
        // Forks share only this invalidation stamp and their captured sources,
        // never a registry of copies. Unchanged outcomes need no rescan.
        this.outcomes = outcomes
        this.revision = outcomes.revision
    }

    get minimum() { this.refresh(); return this.tail?.minimum ?? this.baseline }
    get maximum() { this.refresh(); return this.tail?.maximum ?? this.baseline }

    append(node) {
        node.state = this
        node.previous = this.tail
        if (this.tail) this.tail.next = node
        else this.head = node
        this.tail = node
        const minimum = node.previous?.minimum ?? this.baseline
        const maximum = node.previous?.maximum ?? this.baseline
        node.minimum = Math.max(minimum, node.value ?? 0)
        node.maximum = Math.max(maximum, node.source?.bound ?? node.value ?? 0)
        if (node.question) {
            // Earlier questions already observe their prefix. Subscribe only
            // the new interval, leaving the unobserved tail lazy.
            for (let previous = node.previous; previous && previous !== this.lastQuestion; previous = previous.previous)
                previous.source?.nodes.add(previous)
            this.lastQuestion = node
        }
        return node
    }

    remove(node) {
        if (node === this.lastQuestion) {
            let previous = node.previous
            while (previous && !previous.question) {
                previous.source?.nodes.delete(previous)
                previous = previous.previous
            }
            this.lastQuestion = previous
        }
        if (node.previous) node.previous.next = node.next
        else this.head = node.next
        if (node.next) node.next.previous = node.previous
        else this.tail = node.previous
        node.source?.nodes.delete(node)
        node.state = node.previous = node.next = undefined
    }

    grow(length) {
        if (length <= this.minimum) return
        const node = this.append({ value: length })
        this.compact(node)
    }

    add(bound) {
        if (bound <= this.minimum) return undefined
        const outcomes = this.outcomes
        const source = {
            bound, nodes: new Set(),
            complete(created) {
                if (source.value !== undefined) return
                source.value = created ? bound : 0
                outcomes.revision++
                for (const node of [...source.nodes]) {
                    node.state?.refresh(node)
                }
            },
        }
        this.append({ source })
        return source
    }

    refresh(start = this.head) {
        if (this.revision === this.outcomes.revision) return
        this.revision = this.outcomes.revision
        const ready = []
        // A subscribed node's preceding sources are subscribed too, so that
        // prefix is current. Lazy readers instead refresh the whole sequence.
        let minimum = start?.previous?.minimum ?? this.baseline
        let maximum = start?.previous?.maximum ?? this.baseline
        for (let node = start; node;) {
            const next = node.next
            if (node.source && node.source.bound <= minimum) {
                this.remove(node)
                node = next
                continue
            }
            if (node.source?.value !== undefined) {
                node.value = node.source.value
                node.source.nodes.delete(node)
                node.source = undefined
            }
            minimum = Math.max(minimum, node.value ?? 0)
            maximum = Math.max(maximum, node.source?.bound ?? node.value ?? 0)
            node.minimum = minimum
            node.maximum = maximum
            if (node.question) {
                const answer = lengthAnswer(minimum, maximum, node.index)
                if (answer !== undefined) {
                    const deliver = node.deliver
                    ready.push(() => deliver(answer))
                    this.remove(node)
                }
            } else this.compact(node)
            node = next
        }
        // Finish all list changes before exposing any answer to continuations.
        for (const deliver of ready) deliver()
    }

    compact(node) {
        if (!node || node.source || node.question) return
        // Later growth can subsume earlier contributions, but an intervening
        // question still observes its own prefix without that growth.
        while (node.previous && !node.previous.question &&
            (node.previous.source?.bound ?? node.previous.value) <= node.value)
            this.remove(node.previous)
        if (node.value <= (node.previous?.minimum ?? this.baseline)) {
            this.remove(node)
        } else if (!node.previous) {
            this.baseline = Math.max(this.baseline, node.value)
            this.remove(node)
        }
    }

    resolve(work, onAnswer, index) {
        const answer = lengthAnswer(this.minimum, this.maximum, index)
        if (answer !== undefined) return onAnswer(answer)
        const { promise, resolve } = Promise.withResolvers()
        let unregister
        const node = this.append({ question: true, index, deliver(answer) {
            unregister?.()
            resolve(answer)
        } })
        unregister = releaseOnClose(work, () => {
            if (!node.state) return
            const next = node.next
            this.remove(node)
            this.compact(next)
        })
        return continueOperation(promise, work.operationContext, onAnswer, undefined, work)
    }

    fork() {
        if (this.minimum === this.maximum) return this.minimum
        const copy = new LengthState(this.baseline, this.outcomes)
        for (let node = this.head; node; node = node.next) {
            if (node.source) copy.append({ source: node.source })
            else if (!node.question) copy.grow(node.value)
        }
        return copy
    }

    release() {
        this.unregister?.()
        this.unregister = undefined
        for (let node = this.head; node;) {
            const next = node.next
            this.remove(node)
            node = next
        }
    }
}

function lengthAnswer(minimum, maximum, index) {
    if (index === undefined) return minimum === maximum ? minimum : undefined
    return index < minimum ? true : index >= maximum ? false : undefined
}

function registerArrayGrowth(array, index, operationContext) {
    const meta = metadata.requireMeta(array, operationContext)
    const minimum = publishedArrayLength(array, operationContext)
    if (index < minimum) return undefined
    if (!(meta.arrayLength instanceof LengthState)) meta.arrayLength = new LengthState(minimum)
    return meta.arrayLength.add(index + 1)
}

function captureArrayLength(array, operationContext, owner) {
    const state = metadata.metaOf(array, operationContext)?.arrayLength
    const captured = state instanceof LengthState ? state.fork() : publishedArrayLength(array, operationContext)
    if (owner && captured instanceof LengthState) captured.unregister = releaseOnClose(owner, () => captured.release())
    return captured
}

function copyArrayLength(source, destination, operationContext) {
    metadata.requireMeta(destination, operationContext).arrayLength = captureArrayLength(source, operationContext)
}

function resolveLength(array, work, onLength) {
    const state = metadata.metaOf(array, work.operationContext)?.arrayLength
    return state instanceof LengthState ? state.resolve(work, onLength) :
        onLength(publishedArrayLength(array, work.operationContext))
}

function resolveInRange(array, index, work, onInRange) {
    const state = metadata.metaOf(array, work.operationContext)?.arrayLength
    return state instanceof LengthState ? state.resolve(work, onInRange, index) :
        onInRange(index < publishedArrayLength(array, work.operationContext))
}

export { LengthState, captureArrayLength, copyArrayLength, registerArrayGrowth, resolveLength, resolveInRange }
