// --- Notation ---------------------------------------------------------------
//   a.k.y = 1   -> assignPath(a, ["k", "y"], 1)
//   = a.k.y     -> lookupPath(a, ["k", "y"])
//   delete a.k  -> deletePath(a, ["k"])
//   P(V)        -> a promise P that resolves to value V
//
// A Promise mirror identifies one parent/key property version. Its live value
// stays in the physical property; only a displaced version owns detachedValue.
// ASSIGN and DISCOVERY seed from raw settlement. FORK samples a live source
// mirror at the copier's FIFO position; TRANSFER samples a detached source
// mirror at its new placement.

import "./init.js"

// Load-bearing helper contract:
// The initial resolver converts data rejection through onInitialPromiseResolve.
// Later resolvers use onLaterPromiseReady and read the state published by that
// first FIFO reaction instead of consuming the raw settlement again.

export { Chain } from "./chain.js"

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
