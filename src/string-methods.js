const STRING_METHODS = {
    __proto__: null,
    endsWith: { protocol: Symbol.match },
    includes: { protocol: Symbol.match },
    match: { protocol: Symbol.match },
    matchAll: { protocol: Symbol.matchAll },
    replace: { protocol: Symbol.replace },
    replaceAll: { protocol: Symbol.replace },
    search: { protocol: Symbol.search },
    split: { protocol: Symbol.split },
    startsWith: { protocol: Symbol.match },
}

for (const method of Object.getOwnPropertyNames(String.prototype)) {
    const intrinsic = String.prototype[method]
    if (method === "constructor" || typeof intrinsic !== "function") continue
    const definition = STRING_METHODS[method] ??= {}
    definition.intrinsic = intrinsic
}

export { STRING_METHODS }
