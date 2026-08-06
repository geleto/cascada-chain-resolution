// --- Notation ---------------------------------------------------------------
//   a.k.y = 1   -> assignPath(a, ["k", "y"], 1)
//   = a.k.y     -> lookupPath(a, ["k", "y"])
//   delete a.k  -> deletePath(a, ["k"])
//   P(V)        -> a promise P that resolves to value V
//
// A Promise mirror owns one logical property version. Assignment and discovery
// consume raw settlement; retained and exclusive placements sample a captured
// source mirror at their own FIFO positions.

// Load-bearing helper contract:
// The initial resolver converts data rejection through
// resolveInitialValueOrPoison.
// Later resolvers use onLaterPromiseReady and read the state published by that
// first FIFO reaction instead of consuming the raw settlement again.

export { Chain } from "./chain.js"

export {
    assignPath,
    deletePath,
} from "./mutations.js"

export {
    exportPath as export,
    getErrors,
    hasError,
    lookupPath,
    readPath,
} from "./observations.js"

export { import } from "./import.js"
export { registerDataClass } from "./language-values.js"
export { run } from "./run.js"
