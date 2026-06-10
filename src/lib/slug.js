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
  const prefix = parts.join('-')
  return prefix ? `${prefix}--${item.id}` : item.id
}

export function idFromSlug(slug) {
  // New format: everything after last '--' is the full UUID
  const idx = slug.lastIndexOf('--')
  if (idx !== -1) return slug.slice(idx + 2)
  // Backwards compat: plain UUID or old short-id slug — return as-is and try eq first
  return slug
}
