import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ODOO_URL = Deno.env.get('ODOO_URL') || ''
const ODOO_DB = Deno.env.get('ODOO_DB') || ''
const ODOO_UID = parseInt(Deno.env.get('ODOO_USER_ID') || '0')
const ODOO_API_KEY = Deno.env.get('ODOO_API_KEY') || ''
const JEWELRY_CATEG_ID = 8

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

function buildXmlRpc(model: string, domain: unknown[][], fields: string[], limit = 500) {
  const domainXml = domain.map(([field, op, val]) => {
    let valXml: string
    if (Array.isArray(val)) {
      const items = (val as unknown[]).map(v =>
        typeof v === 'number' ? `<value><int>${v}</int></value>` : `<value><string>${v}</string></value>`
      ).join('')
      valXml = `<value><array><data>${items}</data></array></value>`
    } else if (typeof val === 'boolean') {
      valXml = `<value><boolean>${val ? 1 : 0}</boolean></value>`
    } else if (typeof val === 'number') {
      valXml = `<value><int>${val}</int></value>`
    } else {
      valXml = `<value><string>${val}</string></value>`
    }
    return `<value><array><data><value><string>${field}</string></value><value><string>${op}</string></value>${valXml}</data></array></value>`
  }).join('')

  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('')

  return `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${ODOO_UID}</int></value></param>
    <param><value><string>${ODOO_API_KEY}</string></value></param>
    <param><value><string>${model}</string></value></param>
    <param><value><string>search_read</string></value></param>
    <param><value><array><data><value><array><data>${domainXml}</data></array></value></data></array></value></param>
    <param><value><struct>
      <member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>
      <member><name>limit</name><value><int>${limit}</int></value></member>
    </struct></value></param>
  </params></methodCall>`
}

function parseField(xml: string, fieldName: string): string | null {
  const norm = xml.replace(/>\s+</g, '><')
  const re = new RegExp(`<member><name>${fieldName}<\/name><value>([\\s\\S]*?)<\/value><\/member>`)
  const m = norm.match(re)
  if (!m) return null
  const raw = m[1]
  const intM = raw.match(/<(?:int|i4)>(\d+)<\/(?:int|i4)>/)
  if (intM) return intM[1]
  const strM = raw.match(/<string>([\s\S]*?)<\/string>/)
  if (strM) return strM[1]
  return null
}

function parseStructs(xml: string): Record<string, string>[] {
  const norm = xml.replace(/>\s+</g, '><')
  const results: Record<string, string>[] = []
  const structRe = /<struct>([\s\S]*?)<\/struct>/g
  let sm
  while ((sm = structRe.exec(norm)) !== null) {
    const struct: Record<string, string> = {}
    const memberRe = /<member><name>([^<]+)<\/name><value>([\s\S]*?)<\/value><\/member>/g
    let mm
    while ((mm = memberRe.exec(sm[1])) !== null) {
      const raw = mm[2].trim()
      const intM = raw.match(/<(?:int|i4)>(\d+)<\/(?:int|i4)>/)
      if (intM) { struct[mm[1]] = intM[1]; continue }
      const strM = raw.match(/<string>([\s\S]*?)<\/string>/)
      if (strM) { struct[mm[1]] = strM[1]; continue }
      const dblM = raw.match(/<double>([^<]+)<\/double>/)
      if (dblM) { struct[mm[1]] = dblM[1]; continue }
    }
    if (struct.id) results.push(struct)
  }
  return results
}

async function odooCall(model: string, domain: unknown[][], fields: string[], limit = 500) {
  const xml = buildXmlRpc(model, domain, fields, limit)
  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
  })
  const text = await res.text()
  if (text.includes('<fault>')) throw new Error(`Odoo fault on ${model}: ` + text.substring(0, 300))
  return parseStructs(text)
}

serve(async () => {
  try {
    // 1. Fetch all jewellery products with stock info
    const products = await odooCall(
      'product.template',
      [['sale_ok', '=', true], ['active', '=', true], ['categ_id', '=', JEWELRY_CATEG_ID]],
      ['id', 'virtual_available']
    )

    const soldByStock = products.filter(p => parseFloat(p.virtual_available || '1') <= 0).map(p => p.id)
    const availableByStock = products.filter(p => parseFloat(p.virtual_available || '0') > 0).map(p => p.id)

    // 2. Fetch products in quotation/draft SOs (state = draft or sent)
    //    sale.order.line has product_template_id directly
    const soLines = await odooCall(
      'sale.order.line',
      [['order_id.state', 'in', ['draft', 'sent']]],
      ['product_template_id']
    )

    const inQuotation = new Set(soLines.map(l => l.product_template_id).filter(Boolean))

    // Combine: sold if no stock OR in a quotation
    const allSold = Array.from(new Set([...soldByStock, ...Array.from(inQuotation)]))
    // Available only if has stock AND not in any quotation
    const availableNotInSO = availableByStock.filter(id => !inQuotation.has(id))

    let markedSold = 0
    let markedAvailable = 0

    if (allSold.length > 0) {
      const { data: toSell } = await supabase
        .from('watches')
        .select('id')
        .eq('source', 'odoo')
        .eq('status', 'available')
        .in('odoo_product_id', allSold)

      if (toSell && toSell.length > 0) {
        await supabase.from('watches').update({ status: 'sold' }).in('id', toSell.map(w => w.id))
        markedSold = toSell.length
      }
    }

    if (availableNotInSO.length > 0) {
      const { data: toRestore } = await supabase
        .from('watches')
        .select('id')
        .eq('source', 'odoo')
        .eq('status', 'sold')
        .in('odoo_product_id', availableNotInSO)

      if (toRestore && toRestore.length > 0) {
        await supabase.from('watches').update({ status: 'available' }).in('id', toRestore.map(w => w.id))
        markedAvailable = toRestore.length
      }
    }

    return new Response(
      JSON.stringify({ ok: true, marked_sold: markedSold, marked_available: markedAvailable, in_quotation: inQuotation.size }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('sync-odoo-status error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 })
  }
})
