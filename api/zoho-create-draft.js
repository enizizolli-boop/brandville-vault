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

    // Build custom fields matching the Zoho Inventory field names used by the sync
    const customFields = []
    if (p.brand)              customFields.push({ label: 'Brand',             value: p.brand })
    if (p.model)              customFields.push({ label: 'Model',             value: p.model })
    if (p.condition)          customFields.push({ label: 'Conditions',        value: p.condition })
    if (p.scope_of_delivery)  customFields.push({ label: 'Scope of delivery', value: p.scope_of_delivery })

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
      console.error('Zoho create item error:', JSON.stringify(zohoData))
      return res.status(502).json({ error: zohoData.message || 'Zoho returned an error', details: zohoData })
    }

    const created = zohoData.item
    console.log(`Zoho draft created: ${created.item_id} — ${created.name}`)

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
