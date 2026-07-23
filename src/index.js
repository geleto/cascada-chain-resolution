"use strict"

// --- Notation ---------------------------------------------------------------
//   a.k.y = 1   -> assignPath(a, ["k", "y"], 1)
//   = a.k.y     -> lookupPath(a, ["k", "y"])
//   delete a.k  -> deletePath(a, ["k"])
//   P(V)        -> a promise P that resolves to value V
//
// A promise mirror lives in node's META mirror map:
//   promise              : the exact promise instance assigned to this key
//   currentValue         : the newest resolved value, V -> V' -> V''
//   pendingConsumerCount : registered FIFO consumers not yet completed
// Every mirror consumer registers at its program position. The mirror remains
// pending while this count is positive, then publishes one final value.
//
// A mirror is born at ASSIGN, DISCOVERY, or FORK. ASSIGN and DISCOVERY seed from
// the raw settled value. FORK seeds from the source mirror at the copier's FIFO
// position, so the copied world diverges at exactly that program point.

import * as refcounts from "./refcounts.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as mutations from "./mutations.js"
import * as observations from "./observations.js"

// Load-bearing helper contract:
// Generic data promises use onValueResolve. Property-promise consumers use
// onPromiseMirrorResolve so registration order and the drain counter advance
// together. Rejection becomes a language Error before either continuation runs.

class Chain {
    constructor(initialValue) {
        this._state = { value: initialValue }
        this._commands = []
    }
}

promiseMirrors.initPromiseMirrors(
    refcounts.preparePropertyTransition,
    refcounts.commitMirrorDrain,
)

export { Chain }

export const {
    assignPath,
    deletePath,
} = mutations

export const {
    getErrors,
    hasError,
    lookupPath,
    normalize,
} = observations

const importValue = imports.import
export { importValue as import }
