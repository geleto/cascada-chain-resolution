import { continueGraphTransition } from "./internal-step.js"
import { releaseOnClose } from "./operation-lifecycle.js"

// Contributions and questions share program order. A source outcome can feed
// several captured sequences, but later additions belong to only one sequence.
class LengthState {
    constructor(baseline) {
        this.baseline = baseline
        // Outcomes invalidate only retained sequences that contain them. The
        // counter has no reference back to the sequence or its Array.
        this.outcomes = { revision: 0 }
        this.revision = 0
        this.retentions = 0
    }

    retain() {
        if (this.retentions++ !== 0) return
        this.outcomes.revision++ // An inactive sequence may have missed outcomes.
        this.refresh()
        for (let node = this.head; node; node = node.next)
            node.source?.consumers.set(this.outcomes, undefined)
    }

    release() {
        if (--this.retentions !== 0) return
        for (let node = this.head; node; node = node.next)
            node.source?.consumers.delete(this.outcomes)
    }

    get minimum() { this.refresh(); return this.tail?.minimum ?? this.baseline }
    get maximum() { this.refresh(); return this.tail?.maximum ?? this.baseline }

    currentAnswer(index) {
        return LengthState.lengthAnswer(this.tail?.minimum ?? this.baseline, this.tail?.maximum ?? this.baseline, index)
    }

    answer(index) {
        // Outcomes only tighten these bounds. An already conclusive answer
        // needs neither fresh outcomes nor a scan of the captured sequence.
        const answer = this.currentAnswer(index)
        if (answer !== undefined) return answer
        this.refresh()
        return this.currentAnswer(index)
    }

    static lengthAnswer(minimum, maximum, index) {
        if (index === undefined) return minimum === maximum ? minimum : undefined
        return index < minimum ? true : index >= maximum ? false : undefined
    }

    append(node) {
        if (node.question) this.retain()
        node.state = this
        node.previous = this.tail
        if (this.tail) this.tail.next = node
        else this.head = node
        this.tail = node
        const minimum = node.previous?.minimum ?? this.baseline
        const maximum = node.previous?.maximum ?? this.baseline
        node.minimum = Math.max(minimum, node.value ?? 0)
        node.maximum = Math.max(maximum, node.source?.bound ?? node.value ?? 0)
        if (node.source && this.retentions) node.source.consumers.set(this.outcomes, undefined)
        if (node.deliver) {
            // Earlier active questions already observe their prefix. Subscribe only
            // the new interval, leaving the unobserved tail lazy.
            for (let previous = node.previous; previous && previous !== this.lastActiveQuestion; previous = previous.previous)
                previous.source?.consumers.set(this.outcomes, previous)
            this.lastActiveQuestion = node
        }
        return node
    }

    remove(node) {
        if (node === this.lastActiveQuestion) {
            let previous = node.previous
            while (previous && !previous.deliver) {
                previous.source?.consumers.set(this.outcomes, undefined)
                previous = previous.previous
            }
            this.lastActiveQuestion = previous
        }
        if (node.previous) node.previous.next = node.next
        else this.head = node.next
        if (node.next) node.next.previous = node.previous
        else this.tail = node.previous
        node.source?.consumers.delete(this.outcomes)
        node.state = node.previous = node.next = undefined
        if (node.question) this.release()
    }

    releaseQuestion(node) {
        const next = node.next
        this.remove(node)
        this.compact(next)
    }

    grow(length) {
        if (length <= this.minimum) return
        const node = this.append({ value: length })
        this.compact(node)
    }

    add(bound) {
        if (bound <= this.minimum) return undefined
        const source = {
            // One contribution per sequence: its counter always invalidates,
            // and an optional node requests active notification of its prefix.
            bound, consumers: new Map(),
            complete(created) {
                if (source.value !== undefined) return
                source.value = created ? bound : 0
                const notify = []
                for (const [counter, node] of source.consumers) {
                    counter.revision++
                    if (node) notify.push(node)
                }
                source.consumers.clear()
                for (const node of notify) node.state?.refresh(node)
            },
        }
        this.append({ source })
        return source
    }

    refresh(start = this.head) {
        if (this.retentions && this.revision === this.outcomes.revision) return
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
                node.source.consumers.delete(this.outcomes)
                node.source = undefined
            }
            minimum = Math.max(minimum, node.value ?? 0)
            maximum = Math.max(maximum, node.source?.bound ?? node.value ?? 0)
            node.minimum = minimum
            node.maximum = maximum
            if (node.question) {
                const answer = LengthState.lengthAnswer(minimum, maximum, node.index)
                if (answer !== undefined) {
                    const deliver = node.deliver
                    if (deliver) ready.push(() => deliver(answer))
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
        const answer = this.answer(index)
        if (answer !== undefined) return onAnswer(answer)
        const { promise, resolve } = Promise.withResolvers()
        let unregister
        const node = this.append({ question: true, index, deliver(answer) {
            unregister?.()
            resolve(answer)
        } })
        unregister = releaseOnClose(work, () => node.state?.releaseQuestion(node))
        return continueGraphTransition(promise, work.operationContext, onAnswer, undefined, work)
    }

    // A read retains one position, not an independently mutable sequence.
    // Passive markers need no active notifications; complete traversal reads their
    // answer after its captured placement transitions have finished.
    capture(owner) {
        if (this.minimum === this.maximum) return this.minimum
        const node = this.append({ question: true })
        let unregister
        function release() {
            unregister?.()
            unregister = undefined
            node.state?.releaseQuestion(node)
        }
        if (owner) unregister = releaseOnClose(owner, release)
        return {
            read() {
                node.state?.refresh()
                if (node.minimum !== node.maximum)
                    throw new Error("Complete placement traversal left Array shape unresolved")
                const length = node.minimum
                release()
                return length
            },
            release,
        }
    }

    fork() {
        if (this.minimum === this.maximum) return this.minimum
        const copy = new LengthState(this.baseline)
        for (let node = this.head; node; node = node.next) {
            if (node.source) copy.append({ source: node.source })
            else if (!node.question) copy.compact(copy.append({ value: node.value }))
        }
        return copy
    }
}

export { LengthState }
