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

export { Chain, ContextChain } from "./chain.js"
export { Execution } from "./execution.js"
export {
    CascadaError,
    CompoundPoisonError,
    ERROR_KIND,
    PoisonError,
    RuntimeError,
} from "./error.js"

export {
    assignPath, deletePath,
} from "./mutations.js"

export {
    exportPath as export, getErrors, hasError, lookupPath,
} from "./observations.js"

export { enter } from "./enter.js"
export { import } from "./import.js"
export { run } from "./run.js"
export {
    externalState, managedState, managedStateClass,
} from "./state-declarations.js"
