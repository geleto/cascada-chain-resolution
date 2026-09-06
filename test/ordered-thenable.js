// Test sources own their FIFO queue; this state never belongs to the kernel.
const ready = value => ({ then: onFulfilled => onFulfilled(value) })
const rejected = reason => ({ then: (_onFulfilled, onRejected) => onRejected(reason) })

class OrderedThenable {
    subscribers = []
    outcome = undefined
    subscriptions = 0
    flushOnSubscribe = false
    deferReady = false

    then(onFulfilled, onRejected) {
        this.subscriptions++
        if (this.outcome && this.flushOnSubscribe) this.flush()
        if (this.outcome && this.subscribers.length === 0 && !this.deferReady) {
            const callback = this.outcome.rejected ? onRejected : onFulfilled
            return callback(this.outcome.value)
        }
        const next = this.createPending()
        this.subscribers.push({ onFulfilled, onRejected, next })
        if (this.outcome) queueMicrotask(() => this.flush())
        return next.promise
    }

    createPending() { return Promise.withResolvers() }

    resolve(value) { this.settle(value, false) }
    reject(value) { this.settle(value, true) }

    settle(value, rejected) {
        this.outcome = { value, rejected }
        queueMicrotask(() => this.flush())
    }

    flush() {
        while (this.subscribers.length) {
            const { onFulfilled, onRejected, next } = this.subscribers.shift()
            try {
                const callback = this.outcome.rejected ? onRejected : onFulfilled
                next.resolve(callback(this.outcome.value))
            } catch (error) {
                next.reject(error)
            }
        }
    }
}

// Subscribing to a derived chain first delivers its parent's queued work.
// Both the source and derived chains still own their ordinary FIFO queues.
class ChainedThenable extends OrderedThenable {
    then(onFulfilled, onRejected) {
        if (this.parent?.outcome) this.parent.flush()
        return super.then(onFulfilled, onRejected)
    }

    createPending() {
        const promise = new ChainedThenable()
        promise.parent = this
        return {
            promise,
            resolve: value => promise.resolve(value),
            reject: reason => promise.reject(reason),
        }
    }

    resolve(value) {
        if (value !== null && typeof value === "object" && typeof value.then === "function") {
            value.then(value => this.resolve(value), reason => this.reject(reason))
        } else super.resolve(value)
    }
}

export { ready, rejected, OrderedThenable, ChainedThenable }
