import assert from "node:assert/strict"

// Identify failures from inputs we supplied, never from the expected result of
// the consuming command. Writes can finish issuance without returning their
// Error, so the first witness may be a later read or a scope's stored poison.
class ExternalErrorOracle {
    commands = new Map()
    causes = new Map()
    errors = new Map()

    context(execution, command) {
        const errorContext = Object.freeze({ seq: command.seq })
        this.commands.set(errorContext, command)
        return { execution, errorContext }
    }

    failure(seq, message) {
        const cause = new Error(message)
        this.causes.set(seq, cause)
        return cause
    }

    identify(error, consumer) {
        const producer = this.commands.get(error.errorContext)
        assert(producer, "Error has an unknown source context")
        const { seq, creates } = producer
        if (creates) assert.equal(error.kind, creates, `Error kind for command #${seq}`)
        else assert.equal(producer, consumer, "Local Error was attributed to another command")

        if (error.kind === "ExternalLocationConflict") assert.equal(error.cause, undefined)
        else {
            assert(this.causes.has(seq), `No native failure supplied by command #${seq}`)
            assert.equal(error.cause, this.causes.get(seq), `Error cause for command #${seq}`)
        }
        if (this.errors.has(seq)) assert.equal(error, this.errors.get(seq), `Error identity for command #${seq}`)
        else this.errors.set(seq, error)
        return creates ? `E:${seq}` : `L:${error.kind}`
    }
}

export { ExternalErrorOracle }
