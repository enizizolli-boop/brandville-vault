const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ODOO_URL = (Deno.env.get('ODOO_URL') ?? '').replace(/\/$/, '')
const ODOO_DB = Deno.env.get('ODOO_DB') ?? ''
const ODOO_UID = parseInt(Deno.env.get('ODOO_USER_ID') ?? '0')
const ODOO_API_KEY = Deno.env.get('ODOO_API_KEY') ?? ''
const CATEG_ID = 8

function vx(v: string | number | boolean | string[]): string {
  if (Array.isArray(v)) return `<value><array><data>${v.map(s => `<value><string>${s}</string></value>`).join('')}</data></array></value>`
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`
  if (typeof v === 'number') return `<value><int>${v}</int></value>`
  return `<value><string>${v}</string></value>`
}

function rpc(model: string, domain: [string, string, string | number | boolean | string[]][], fields: string[]): string {
  const d = domain.map(([f, op, v]) => `<value><array><data><value><string>${f}</string></value><value><string>${op}</string></value>${vx(v)}</data></array></value>`).join('')
  const fl = fields.map(f => `<value><string>${f}</string></value>`).join('')
  return `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params><param><value><string>${ODOO_DB}</string></value></param><param><value><int>${ODOO_UID}</int></value></param><param><value><string>${ODOO_API_KEY}</string></value></param><param><value><string>${model}</string></value></param><param><value><string>search_read</string></value></param><param><value><array><data><value><array><data>${d}</data></array></value></data></array></value></param><param><value><struct><member><name>fields</name><value><array><data>${fl}</data></array></value></member><member><name>limit</name><value><int>500</int></value></member></struct></value></param></params></methodCall>`
}

function px(xml: string): Record<string, string>[] {
  const n = xml.replace(/>\s+</g, '><'), r: Record<string, string>[] = []
  const sr = /<struct>([\s\S]*?)<\/struct>/g
  let sm: RegExpExecArray | null
  while ((sm = sr.exec(n)) !== null) {
    const o: Record<string, string> = {}
    const mr = /<member><name>([^<]+)<\/name><value>([\s\S]*?)<\/value><\/member>/g
    let mm: RegExpExecArray | null
    while ((mm = mr.exec(sm[1])) !== null) {
      const raw = mm[2].trim()
      const im = raw.match(/<(?:int|i4)>(\d+)<\/(?:int|i4)>/) || raw.match(/<double>([^<]+)<\/double>/)
      if (im) { o[mm[1]] = im[1]; continue }
      const sm2 = raw.match(/<string>([\s\S]*?)<\/string>/)
      if (sm2) o[mm[1]] = sm2[1]
    }
    if (o.id) r.push(o)
  }
  return r
}

async function odoo(model: string, domain: [string, string, string | number | boolean | string[]][], fields: string[]) {
  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: rpc(model, domain, fields) })
  const t = await res.text()
  if (t.includes('<fault>')) throw new Error(`[${model}] ` + t.slice(0, 200))
  return px(t)
}

async function sbGet(filters: string, inVals: string[]) {
  if (!inVals.length) return [] as { id: string }[]
  const res = await fetch(`${SUPABASE_URL}/rest/v1/watches?select=id&${filters}&odoo_product_id=in.(${inVals.join(',')})`, {
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY }
  })
  return await res.json() as { id: string }[]
}

async function sbPatch(ids: string[], status: string) {
  if (!ids.length) return
  await fetch(`${SUPABASE_URL}/rest/v1/watches?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status })
  })
}

Deno.serve(async () => {
  try {
    const products = await odoo('product.template', [['sale_ok', '=', true], ['active', '=', true], ['categ_id', '=', CATEG_ID]], ['id', 'virtual_available'])
    const noStock = products.filter(p => parseFloat(p.virtual_available ?? '1') <= 0).map(p => p.id)
    const hasStock = products.filter(p => parseFloat(p.virtual_available ?? '0') > 0).map(p => p.id)

    const lines = await odoo('sale.order.line', [['order_id.state', 'in', ['draft', 'sent']]], ['product_template_id'])
    const inSO = new Set(lines.map(l => l.product_template_id).filter(Boolean))

    const allSold = [...new Set([...noStock, ...inSO])]
    const nowAvail = hasStock.filter(id => !inSO.has(id))

    const toSell = await sbGet('source=eq.odoo&status=eq.available', allSold)
    await sbPatch(toSell.map(w => w.id), 'sold')

    const toFree = await sbGet('source=eq.odoo&status=eq.sold', nowAvail)
    await sbPatch(toFree.map(w => w.id), 'available')

    return new Response(JSON.stringify({ ok: true, sold: toSell.length, restored: toFree.length, in_quotation: inSO.size }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
})
