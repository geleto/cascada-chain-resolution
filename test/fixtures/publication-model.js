// Independent, persistent graph model for the publication-pair vocabulary.
// A semantic write copies its path; no-op commands return the same objects.
// Poison retains a placement baseline for repair. No runtime metadata is read.
const ERROR = Symbol("poison")
const poison = recovery => ({ [ERROR]: true, recovery })
const isError = value => Boolean(value?.[ERROR])
const container = value => value !== null && typeof value === "object" && !isError(value)
const read = (root, path) => {
    for (const key of path) {
        if (!container(root)) return isError(root) ? root : poison()
        root = root[key]
    }
    return root
}
const placement = (root, path) => path.length === 0 ? { present: true, value: root }
    : { present: Object.hasOwn(read(root, path.slice(0, -1)), path.at(-1)), value: read(root, path) }
const copy = value => Object.assign(Array.isArray(value) ? new Array(value.length) : {}, value)

function write(root, path, value, present = true) {
    if (!path.length) return value
    const result = copy(root), [key, ...rest] = path
    if (rest.length) result[key] = write(root[key], rest, value, present)
    else if (present) result[key] = value
    else delete result[key]
    return result
}

function select(root, path, scope) {
    let value = root
    for (let depth = 0; depth < path.length; depth++) {
        if (isError(value)) return depth <= scope ? { blocked: true } : { failure: scope }
        if (!container(value)) return { failure: Math.min(depth, scope) }
        if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(String(path[depth])))
            return { failure: Math.min(depth, scope) }
        if (depth === path.length - 1) return { parent: value }
        value = value[path[depth]]
    }
}

const relative = (index, length, fallback) => index === undefined ? fallback
    : index < 0 ? Math.max(length + index, 0) : Math.min(index, length)
function writesArray(array, method, args) {
    if (method === "fill") return relative(args[1], array.length, 0) < relative(args[2], array.length, array.length)
    if (method === "reverse") return Object.keys(array).some(key => Number(key) !== array.length - Number(key) - 1)
    if (method === "sort") return Object.keys(array).length > 0
    if (method === "copyWithin") {
        const target = relative(args[0], array.length, 0), start = relative(args[1], array.length, 0)
        const count = Math.min(relative(args[2], array.length, array.length) - start, array.length - target)
        for (let index = 0; index < count; index++)
            if (Object.hasOwn(array, start + index) || Object.hasOwn(array, target + index)) return true
        return false
    }
    return true // push/pop/splice explicitly write length, including empty calls.
}

function apply(root, command, base = []) {
    const path = [...base, ...command.path], scope = base.length + (command.scope ?? command.path.length)
    if (command.kind === "enter") {
        for (const child of command.body) {
            root = apply(root, child, path)
            if (root === undefined) break
        }
        return root
    }
    if (!path.length || command.kind === "method" || command.value?.type === "alias") return undefined
    if (command.kind === "repair") {
        if (!container(read(root, path.slice(0, -1)))) return root
        const value = read(root, path)
        return isError(value) && value.recovery
            ? write(root, path, value.recovery.value, value.recovery.present) : root
    }
    const selected = select(root, command.kind === "array" ? [...path, 0] : path, scope)
    if (selected.blocked) return root
    if (selected.failure !== undefined) {
        const failed = path.slice(0, selected.failure)
        return write(root, failed, poison(placement(root, failed)))
    }
    if (command.kind === "delete") return Object.hasOwn(selected.parent, path.at(-1)) ? write(root, path, undefined, false) : root
    if (command.kind === "assign" || command.kind === "fail")
        return write(root, path, command.kind === "fail" ? 5 : command.value.type === "num" ? command.value.n : { n: 1 })
    if (command.kind === "array") {
        const array = read(root, path)
        if (!Array.isArray(array)) return undefined
        if (command.method === "sort" && Object.values(array).some(isError)) {
            const failed = path.slice(0, scope)
            return write(root, failed, poison(placement(root, failed)))
        }
        if (!writesArray(array, command.method, command.args)) return root
        const next = copy(array)
        Array.prototype[command.method].apply(next, command.args)
        return write(root, path, next)
    }
    return undefined
}

function modelPublications(program, paths) {
    const shared = { m: 1 }
    const roots = [{ a: { x: 1, s: shared, inc() {}, get() {} }, b: [1, , 3], c: { y: { z: 1 }, s: shared } }]
    for (const command of program) {
        const next = apply(roots.at(-1), command)
        if (next === undefined) return undefined // Outside this bounded model.
        roots.push(next)
    }
    const comparisons = new Map()
    for (let step = 0; step + 1 < roots.length; step++) paths.forEach((path, index) => {
        const before = read(roots[step], path), after = read(roots[step + 1], path)
        if (isError(before) || isError(after)) return
        comparisons.set(`includes ${step * paths.length + index} in ${(step + 1) * paths.length + index}`, before === after)
    })
    return { comparisons, failed: roots.some(root => paths.some(path => isError(read(root, path)))) }
}

export { modelPublications }
