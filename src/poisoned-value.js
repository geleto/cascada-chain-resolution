class PoisonedValue {
    constructor(error) {
        this.error = error
        Object.freeze(this)
    }

    then(_onFulfilled, onRejected) {
        return typeof onRejected === "function" ? onRejected(this.error) : this
    }
}

function createPoisonedValue(error) {
    return new PoisonedValue(error)
}

function isPoisonedValue(value) {
    return value instanceof PoisonedValue
}

export { createPoisonedValue, isPoisonedValue }
