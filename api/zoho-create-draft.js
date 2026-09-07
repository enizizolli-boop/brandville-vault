/**
 * POST /api/zoho-create-draft
 * Called when an item is marked as sold in Vault.
 * Creates an inactive (draft) item in Zoho Inventory so the team can
 * review and activate it without any manual re-entry.
 */

const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID

async function parseJsonSafe(res, context) {
  const text = await res.text()
  if (!text) throw new Error(`${context} returned empty body (status ${res.status})`)
  try { return JSON.parse(text) } catch {
    throw new Error(`${context} returned non-JSON (status ${res.status}): ${text.slice(0, 300)}`)
  }
}

async function getAccessToken() {
  const res = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  const data = await parseJsonSafe(res, 'Zoho OAuth')
  if (!data.access_token) throw new Error('No access_token: ' + JSON.stringify(data))
  return data.access_token
}

// Must match Zoho's dropdown options exactly (same list as zoho-sync.js)
const ZOHO_CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair',
  'Needs Repair',
  'Repaired',
  'Repaired Albania',
  'New / unworn',
]

function mapCondition(c) {
  if (!c) return null
  if (ZOHO_CONDITIONS.includes(c)) return c
  const lower = c.toLowerCase()
  if (lower.includes('minor'))   return 'pre-owned conditions with MINOR signs of usage'
  if (lower.includes('major'))   return 'pre-owned conditions with MAJOR signs of usage'
  if (lower.includes('fair'))    return 'Fair'
  if (lower.includes('repair') && lower.includes('albania')) return 'Repaired Albania'
  if (lower.includes('repair'))  return 'Needs Repair'
  if (lower.includes('new'))     return 'New / unworn'
  return null  // don't send invalid dropdown values
}

function buildItemName(p) {
  let name = [p.brand, p.model].filter(Boolean).join(' ')
  if (p.reference) name += ` Ref. ${p.reference}`
  return name || 'Unnamed Watch'
}

function buildDescription(p) {
  const lines = []
  if (p.condition) lines.push(`Condition: ${p.condition}`)
  if (p.scope_of_delivery) lines.push(`Scope of delivery: ${p.scope_of_delivery}`)
  if (p.category) lines.push(`Category: ${p.category}`)
  if (p.notes) lines.push(`Notes: ${p.notes}`)
  lines.push(`Vault ID: ${p.id}`)
  return lines.join('\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const p = req.body
  if (!p || !p.id) {
    return res.status(400).json({ error: 'Missing product data' })
  }

  try {
    const token = await getAccessToken()

    // Fetch exact custom field labels from Zoho settings so we don't hardcode wrong ones
    let cfBrandLabel = 'Brand', cfModelLabel = 'Model', cfCondLabel = 'Conditions', cfScopeLabel = null
    try {
      const cfRes = await fetch(
        `https://www.zohoapis.eu/inventory/v1/settings/customfields?entity=item&organization_id=${ZOHO_ORG_ID}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      )
      const cfData = await cfRes.json()
      const fields = cfData.customfields || []
      for (const f of fields) {
        const api = (f.api_name || '').toLowerCase()
        if (api === 'cf_brand')             cfBrandLabel = f.label
        if (api === 'cf_model')             cfModelLabel = f.label
        if (api === 'cf_conditions')        cfCondLabel  = f.label
        if (api === 'cf_scope_of_delivery') cfScopeLabel = f.label
      }
      console.log('Custom field labels:', { cfBrandLabel, cfModelLabel, cfCondLabel, cfScopeLabel })
    } catch (e) {
      console.warn('Could not fetch custom field labels, using defaults:', e.message)
    }

    const mappedCondition = mapCondition(p.condition)
    const customFields = []
    if (p.brand)                              customFields.push({ label: cfBrandLabel, value: p.brand })
    if (p.model)                              customFields.push({ label: cfModelLabel, value: p.model })
    if (mappedCondition)                      customFields.push({ label: cfCondLabel,  value: mappedCondition })
    if (p.scope_of_delivery && cfScopeLabel)  customFields.push({ label: cfScopeLabel, value: p.scope_of_delivery })

    const itemPayload = {
      name: buildItemName(p),
      item_type: 'inventory',
      unit: 'pcs',
      status: 'inactive',           // "draft" equivalent in Zoho Inventory
      description: buildDescription(p),
      ...(p.reference ? { sku: p.reference } : {}),
      ...(p.price_eur  ? { rate: Number(p.price_eur) } : {}),
      ...(customFields.length ? { custom_fields: customFields } : {}),
    }

    const zohoRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items?organization_id=${ZOHO_ORG_ID}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(itemPayload),
      }
    )

    const zohoData = await parseJsonSafe(zohoRes, 'Zoho create item')

    if (zohoData.code !== 0) {
      const errMsg = zohoData.message || JSON.stringify(zohoData)
      console.error('Zoho create item error:', errMsg, JSON.stringify(itemPayload))
      return res.status(502).json({ error: errMsg, details: zohoData })
    }

    const created = zohoData.item
    console.log(`Zoho draft created: ${created.item_id} — ${created.name}`)

    // Zoho generates the auto-name at creation before applying custom fields from the
    // request body, so brand/conditions/scope end up as dashes. A follow-up PUT with
    // the same custom fields forces Zoho to regenerate the name correctly.
    if (customFields.length) {
      try {
        const updateRes = await fetch(
          `https://www.zohoapis.eu/inventory/v1/items/${created.item_id}?organization_id=${ZOHO_ORG_ID}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Zoho-oauthtoken ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ custom_fields: customFields }),
          }
        )
        const updateData = await parseJsonSafe(updateRes, 'Zoho update item')
        if (updateData.code === 0) {
          console.log(`Zoho name after update: ${updateData.item?.name}`)
        } else {
          console.warn('Zoho update (name refresh) failed:', updateData.message)
        }
      } catch (e) {
        console.warn('Zoho update (name refresh) error:', e.message)
      }
    }

    return res.status(200).json({
      ok: true,
      zoho_item_id: created.item_id,
      zoho_item_name: created.name,
    })
  } catch (err) {
    console.error('zoho-create-draft error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
