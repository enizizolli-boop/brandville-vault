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

function buildXml(domain: [string, string, unknown][]) {
  const domainXml = domain.map(([field, op, val]) => {
    let valXml: string
    if (typeof val === 'boolean') valXml = `<value><boolean>${val ? 1 : 0}</boolean></value>`
    else if (typeof val === 'number') valXml = `<value><int>${val}</int></value>`
    else valXml = `<value><string>${val}</string></value>`
    return `<value><array><data><value><string>${field}</string></value><value><string>${op}</string></value>${valXml}</data></array></value>`
  }).join('')

  return `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${ODOO_UID}</int></value></param>
    <param><value><string>${ODOO_API_KEY}</string></value></param>
    <param><value><string>product.template</string></value></param>
    <param><value><string>search_read</string></value></param>
    <param><value><array><data><value><array><data>${domainXml}</data></array></value></data></array></value></param>
    <param><value><struct>
      <member><name>fields</name><value><array><data>
        <value><string>id</string></value>
        <value><string>virtual_available</string></value>
      </data></array></value></member>
      <member><name>limit</name><value><int>500</int></value></member>
    </struct></value></param>
  </params></methodCall>`
}

function parseIds(xml: string): { id: number; virtual_available: number }[] {
  const norm = xml.replace(/>\s+</g, '><')
  const items: { id: number; virtual_available: number }[] = []
  const structRe = /<struct>([\s\S]*?)<\/struct>/g
  let sm
  while ((sm = structRe.exec(norm)) !== null) {
    const item: Record<string, unknown> = {}
    const memberRe = /<member><name>([^<]+)<\/name><value>([\s\S]*?)<\/value><\/member>/g
    let mm
    while ((mm = memberRe.exec(sm[1])) !== null) {
      const raw = mm[2].trim()
      const intM = raw.match(/^<(?:int|i4|double)>([^<]+)<\/(?:int|i4|double)>$/)
      if (intM) item[mm[1]] = parseFloat(intM[1])
      else {
        const strM = raw.match(/^<string>([\s\S]*)<\/string>$/)
        if (strM) item[mm[1]] = strM[1]
        else {
          // Handle array values like [id, name] for product_id
          const arrM = raw.match(/^<array><data><value><(?:int|i4)>(\d+)<\/(?:int|i4)>/)
          if (arrM) item[mm[1]] = parseInt(arrM[1])
        }
      }
    }
    if (item.id !== undefined) {
      items.push({ id: item.id as number, virtual_available: (item.virtual_available as number) ?? 0 })
    }
  }
  return items
}

function parseProductIds(xml: string): number[] {
  const norm = xml.replace(/>\s+</g, '><')
  const productIds: number[] = []
  const structRe = /<struct>([\s\S]*?)<\/struct>/g
  let sm
  while ((sm = structRe.exec(norm)) !== null) {
    const memberRe = /<member><name>product_id<\/name><value>([\s\S]*?)<\/value><\/member>/g
    const mm = memberRe.exec(sm[1])
    if (mm) {
      // product_id comes as [id, name] in XML
      const idM = mm[1].match(/<int>(\d+)<\/int>/)
      if (idM) productIds.push(parseInt(idM[1]))
    }
  }
  return productIds
}

serve(async () => {
  try {
    // 1. Fetch all Odoo jewellery products (active) with stock info
    const xml = buildXml([
      ['sale_ok', '=', true],
      ['active', '=', true],
      ['categ_id', '=', JEWELRY_CATEG_ID],
    ])

    const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: xml,
    })
    const text = await res.text()
    if (text.includes('<fault>')) throw new Error('Odoo fault: ' + text.substring(0, 200))

    const products = parseIds(text)

    const soldInOdoo = products.filter(p => p.virtual_available <= 0).map(p => String(p.id))

    // 2. Also fetch products from sales orders in quotation/draft/sent status
    const soXml = buildXml([
      ['state', 'in', ['draft', 'sent', 'quotation']],
    ])

    let soProducts = new Set<string>()
    try {
      const soFetch = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: soXml.replace('product.template', 'sale.order'),
      })
      const soText = await soFetch.text()
      if (!soText.includes('<fault>')) {
        const orders = parseIds(soText)
        // For each SO, fetch its order lines to get products
        for (const order of orders) {
          const lineXml = buildXml([['order_id', '=', order.id]])
          const lineFetch = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: lineXml.replace('product.template', 'sale.order.line'),
          })
          const lineText = await lineFetch.text()
          if (!lineText.includes('<fault>')) {
            const productIds = parseProductIds(lineText)
            productIds.forEach(id => soProducts.add(String(id)))
          }
        }
      }
    } catch (e) {
      console.error('SO fetch error:', e)
    }

    const availableInOdoo = products.filter(p => p.virtual_available > 0).map(p => String(p.id))

    // Combine sold from low stock and sold from quotation SO
    const allSoldInOdoo = Array.from(new Set([...soldInOdoo, ...soProducts]))

    let markedSold = 0
    let markedAvailable = 0

    // 3. Mark as sold: products with no stock in Odoo or in quotation SO that are still 'available' in Supabase
    if (allSoldInOdoo.length > 0) {
      const { data: toSell } = await supabase
        .from('watches')
        .select('id')
        .eq('source', 'odoo')
        .eq('status', 'available')
        .in('odoo_product_id', allSoldInOdoo)

      if (toSell && toSell.length > 0) {
        const ids = toSell.map(w => w.id)
        await supabase.from('watches').update({ status: 'sold' }).in('id', ids)
        markedSold = ids.length
      }
    }

    // 4. Mark as available: products back in stock in Odoo AND not in any quotation SO that are 'sold' in Supabase
    const availableNotInSO = availableInOdoo.filter(id => !soProducts.has(id))
    if (availableNotInSO.length > 0) {
      const { data: toRestore } = await supabase
        .from('watches')
        .select('id')
        .eq('source', 'odoo')
        .eq('status', 'sold')
        .in('odoo_product_id', availableNotInSO)

      if (toRestore && toRestore.length > 0) {
        const ids = toRestore.map(w => w.id)
        await supabase.from('watches').update({ status: 'available' }).in('id', ids)
        markedAvailable = ids.length
      }
    }

    return new Response(
      JSON.stringify({ ok: true, marked_sold: markedSold, marked_available: markedAvailable }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('sync-odoo-status error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 })
  }
})
