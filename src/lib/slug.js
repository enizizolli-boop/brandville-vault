function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function toSlug(item) {
  const parts = [slugify(item.brand), slugify(item.model)].filter(Boolean)
  const shortId = (item.id || '').slice(0, 8)
  return [...parts, shortId].filter(Boolean).join('-')
}

export function idFromSlug(slug) {
  // Backwards compat: full UUID passed directly
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
    return { isShort: false, value: slug }
  }
  // New format: last segment is the 8-char short ID
  const parts = slug.split('-')
  return { isShort: true, value: parts[parts.length - 1] }
}
