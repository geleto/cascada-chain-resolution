// Test sources own their FIFO queue; this state never belongs to the kernel.
const ready = value => ({ then: onFulfilled => onFulfilled(value) })
const rejected = reason => ({ then: (_onFulfilled, onRejected) => onRejected(reason) })

class OrderedThenable {
    subscribers = []
    outcome = undefined
    subscriptions = 0
    flushOnSubscribe = false

    then(onFulfilled, onRejected) {
        this.subscriptions++
        if (this.outcome && this.flushOnSubscribe) this.flush()
        if (this.outcome && this.subscribers.length === 0) {
            const callback = this.outcome.rejected ? onRejected : onFulfilled
            return callback(this.outcome.value)
        }
        const next = Promise.withResolvers()
        this.subscribers.push({ onFulfilled, onRejected, next })
        return next.promise
    }

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

export { ready, rejected, OrderedThenable }
