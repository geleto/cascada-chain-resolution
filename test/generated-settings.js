// These settings are external verification inputs. Reject invalid ranges before
// generating cases, so an empty run cannot be mistaken for successful coverage.
export function readIntegerSetting(name, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    const supplied = process.env[name]
    const value = Number(supplied ?? fallback)
    if (supplied?.trim() === "" || !Number.isSafeInteger(value) || value < minimum || value > maximum)
        throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`)
    return value
}

export function readShard(value, name, total = Infinity) {
    const [index, count] = /^\d+\/\d+$/.test(value) ? value.split("/").map(Number) : []
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) ||
        count <= 0 || index < 0 || index >= count || index >= total)
        throw new Error(`${name} must be index/count with 0 <= index < count and select at least one case`)
    return [index, count]
}
