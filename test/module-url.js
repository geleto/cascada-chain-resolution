// Node can report a Windows drive with different casing at separate ESM entry
// points. Preserve path case: only the drive letter is case-insensitive here.
export function normalizeModuleURL(value) {
    const url = new URL(value)
    url.hash = ""
    if (url.protocol === "file:")
        url.pathname = url.pathname.replace(/^\/[A-Z]:/, drive => drive.toLowerCase())
    return url.href
}
