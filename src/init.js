import * as promiseMirrors from "./promise-mirrors.js"
import * as propertyTransitions from "./property-transitions.js"

// Internal entry points may be imported without the package facade. Keep the
// circular runtime wiring in a shared bootstrap so every entry point sees
// the same initialized modules.
promiseMirrors.initPromiseMirrors(propertyTransitions.setMirrorValue)
