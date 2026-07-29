import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as propertyTransitions from "./property-transitions.js"
import * as refcounts from "./refcounts.js"

// Internal entry points may be imported without the package facade. Keep the
// cycle-breaking runtime wiring in a shared bootstrap so every entry point sees
// the same initialized modules.
imports.initImport(refcounts.commitLiveEdge)
promiseMirrors.initPromiseMirrors(propertyTransitions.setMirrorValue)
