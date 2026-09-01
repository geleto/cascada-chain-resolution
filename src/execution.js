class Execution {
    _externalIdentities = new WeakMap()

    _getOrCreateExternalIdentityEntry(identity) {
        let entry = this._externalIdentities.get(identity)
        if (!entry) {
            entry = {}
            this._externalIdentities.set(identity, entry)
        }
        return entry
    }
}

export { Execution }
