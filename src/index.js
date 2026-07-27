// --- Notation ---------------------------------------------------------------
//   a.k.y = 1   -> assignPath(a, ["k", "y"], 1)
//   = a.k.y     -> lookupPath(a, ["k", "y"])
//   delete a.k  -> deletePath(a, ["k"])
//   P(V)        -> a promise P that resolves to value V
//
// A Promise mirror identifies one parent/key property version. Its live value
// stays in the physical property; only a displaced version owns detachedValue.
// ASSIGN and DISCOVERY seed from raw settlement. FORK samples the source
// mirror at the copier's FIFO position, so the worlds diverge there.

import * as refcounts from "./refcounts.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as propertyTransitions from "./property-transitions.js"

// Load-bearing helper contract:
// The initial resolver converts data rejection through onInitialPromiseResolve.
// Later resolvers use onLaterPromiseReady and read the state published by that
// first FIFO reaction instead of consuming the raw settlement again.

export class Chain {
    constructor(initialValue) {
        this._state = { value: initialValue }
        this._commands = []
    }
}

imports.initImport(refcounts.commitLiveEdge)
promiseMirrors.initPromiseMirrors(propertyTransitions.setMirrorValue)

export {
    assignPath,
    deletePath,
} from "./mutations.js"

export {
    exportValue as export,
    getErrors,
    hasError,
    lookupPath,
} from "./observations.js"

export { import } from "./import.js"
