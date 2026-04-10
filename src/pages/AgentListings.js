import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useExchangeRate } from '../hooks/useExchangeRate'
import { useCurrency } from '../context/CurrencyContext'
import Topbar from '../components/Topbar'
import WATCH_REFS from '../data/watchRefs'

const CATEGORIES = ['Watches', 'Jewellery', 'Bags']

const CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair',
  'Needs Repair',
  'Repaired',
  'Repaired Albania',
]

const BRANDS = [
  'A. Lange & Söhne','Audemars Piguet','Balenciaga','Blancpain','Bottega Veneta',
  'Breguet','Breitling','Bulgari','Cartier','Celine','Chanel','Chopard','De Beers',
  'Dior','Fendi','Girard-Perregaux','Graff','Grand Seiko','Gucci','Harry Winston',
  'Hermès','Hublot','IWC','Jaeger-LeCoultre','Loewe','Louis Vuitton','Mikimoto',
  'Omega','Other','Panerai','Patek Philippe','Piaget','Prada','Richard Mille','Rolex',
  'Saint Laurent','TAG Heuer','Tiffany & Co','Tudor','Ulysse Nardin','Vacheron Constantin',
  'Van Cleef & Arpels','Zenith'
]

const JEWELLERY_BRANDS = new Set([
  'balenciaga','bottega veneta','bulgari','cartier','celine','chanel','de beers',
  'dior','fendi','gucci','hermès','hermes','loewe','louis vuitton','mikimoto',
  'prada','saint laurent','tiffany & co','van cleef & arpels','harry winston','graff','chopard','piaget',
])

const BAG_BRANDS = new Set([
  'balenciaga','bottega veneta','celine','chanel','dior','fendi','gucci',
  'hermès','hermes','loewe','louis vuitton','prada','saint laurent',
])

const SCOPE_KEYWORDS = [
  { match: /card\s*[&+]\s*box/i, value: 'Card & Box' },
  { match: /with\s+card/i, value: 'With Card' },
  { match: /with\s+box/i, value: 'With Box' },
  { match: /watch\s+only/i, value: 'Watch Only' },
]

const METAL_KEYWORDS = [
  { match: /yellow\s*gold/i, value: 'Yellow Gold' },
  { match: /pink\s*gold|rose\s*gold/i, value: 'Pink Gold' },
  { match: /white\s*gold/i, value: 'White Gold' },
  { match: /platinum/i, value: 'Platinum' },
]

const JEWELLERY_TYPE_KEYWORDS = [
  { match: /\bearrings?\b|\bstuds?\b|\bhoops?\b/i, value: 'Earrings' },
  { match: /\bbracelets?\b/i, value: 'Bracelets' },
  { match: /\bnecklaces?\b|\bpendant/i, value: 'Necklaces' },
  { match: /\brings?\b/i, value: 'Rings' },
]

function parseQuickPost(text) {
  const result = { ...EMPTY_FORM }
  if (!text.trim()) return result

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const fullText = text // keep for keyword scanning

  // --- Brand detection (scan all lines) ---
  const sortedBrands = [...BRANDS].sort((a, b) => b.length - a.length)
  const fullLower = fullText.toLowerCase()
  for (const brand of sortedBrands) {
    if (fullLower.includes(brand.toLowerCase())) { result.brand = brand; break }
  }
  const abbreviations = { 'Audemars Piguet': /\bAP\b/, 'Patek Philippe': /\bPP\b/, 'Vacheron Constantin': /\bVC\b/i, 'Jaeger-LeCoultre': /\bJLC\b/, 'Richard Mille': /\bRM\b/, 'Van Cleef & Arpels': /\bVCA\b/, 'Louis Vuitton': /\bLV\b/ }
  for (const [brand, re] of Object.entries(abbreviations)) {
    if (re.test(fullText)) { result.brand = brand; break }
  }

  // Helper: parse a price string (58'000€, €35,000, 52.320, 13050)
  function parsePrice(str) {
    const m = str.match(/([\d]['\d,.\s]*[\d])/)
    if (!m) return ''
    const raw = m[1].replace(/['\s]/g, '')
    const dots = (raw.match(/\./g) || []).length
    const commas = (raw.match(/,/g) || []).length
    let num
    if (dots > 1) num = raw.replace(/\./g, '')
    else if (commas > 1) num = raw.replace(/,/g, '')
    else if (dots === 1 && commas > 0) num = raw.replace(/[.,]/g, '')
    else if (commas === 1 && raw.indexOf(',') > raw.length - 4) num = raw.replace(',', '.')
    else num = raw.replace(/,/g, '')
    return String(Math.round(Number(num)))
  }

  // --- Process each line ---
  let modelLine = ''
  const noteLines = []
  for (const line of lines) {
    const lineLower = line.toLowerCase()

    // Net/cost price line: "Net Price 52'320€" or "Net - 15'250€ - 17'850$ | WeChat: c713671"
    if (/\bnet\b/i.test(lineLower) && /\d/.test(line)) {
      // Extract vendor if after | on same line
      if (line.includes('|')) {
        const [pricePart, vendorPart] = line.split('|').map(s => s.trim())
        const eurNet = pricePart.match(/([\d]['\d,.\s]*[\d])\s*€/)
        result.cost_eur = eurNet ? parsePrice(eurNet[0]) : parsePrice(pricePart)
        const vendorMatch = vendorPart.match(/(?:vendor|wechat)[:\s]*(.+)/i)
        if (vendorMatch) result.vendor = vendorMatch[1].trim()
        else result.vendor = vendorPart
      } else {
        const eurNet = line.match(/([\d]['\d,.\s]*[\d])\s*€/)
        result.cost_eur = eurNet ? parsePrice(eurNet[0]) : parsePrice(line)
      }
      continue
    }

    // Price line: has € or $ or apostrophe-separated number, or just digits
    const hasPrice = /[€$]/.test(line) || /\d[']\d/.test(line) || /^[\d',.€$\s\-]+$/.test(line.trim())
    if (hasPrice && /\d{3,}/.test(line.replace(/'/g, ''))) {
      // If line has both € and $, extract the EUR part
      const eurMatch = line.match(/([\d]['\d,.\s]*[\d])\s*€/)
      if (eurMatch) {
        result.price_eur = parsePrice(eurMatch[0])
      } else {
        result.price_eur = parsePrice(line)
      }
      continue
    }

    // Condition line
    if (/pre-owned|minor|major|\bfair\b|needs?\s*repair|repaired/i.test(lineLower)) {
      if (/major/i.test(line)) result.condition = 'pre-owned conditions with MAJOR signs of usage'
      else if (/minor/i.test(line)) result.condition = 'pre-owned conditions with MINOR signs of usage'
      else if (/repair.*albania/i.test(line)) result.condition = 'Repaired Albania'
      else if (/repaired/i.test(line)) result.condition = 'Repaired'
      else if (/needs?\s*repair/i.test(line)) result.condition = 'Needs Repair'
      else if (/\bfair\b/i.test(line)) result.condition = 'Fair'
      continue
    }

    // Scope line (also handle "Card only" → "With Card", "Box only" → "With Box")
    let matchedScope = false
    if (/\bfull\s+set\b/i.test(line)) { result.scope_of_delivery = 'Card & Box'; matchedScope = true }
    else if (/\bcard\s+only\b/i.test(line)) { result.scope_of_delivery = 'With Card'; matchedScope = true }
    else if (/\bbox\s+only\b/i.test(line)) { result.scope_of_delivery = 'With Box'; matchedScope = true }
    else {
      for (const s of SCOPE_KEYWORDS) {
        if (s.match.test(line)) { result.scope_of_delivery = s.value; matchedScope = true; break }
      }
    }
    if (matchedScope) {
      const yearMatch = line.match(/\b(20[12]\d)\b/)
      if (yearMatch) noteLines.push(yearMatch[1])
      continue
    }

    // Vendor line → vendor field (Vendor:, WeChat:, or after | on net line)
    if (/\bvendor\b/i.test(lineLower) || /\bwechat\b/i.test(lineLower)) {
      const vendorMatch = line.match(/(?:vendor|wechat)[:\s]*(.+)/i)
      if (vendorMatch) result.vendor = vendorMatch[1].trim()
      continue
    }

    // Metal type line
    let matchedMetal = false
    for (const m of METAL_KEYWORDS) {
      if (m.match.test(line)) { result.metal_type = m.value; matchedMetal = true; break }
    }
    if (matchedMetal) continue

    // Otherwise this is likely the brand + model line (take the first unmatched line)
    if (!modelLine) modelLine = line
  }

  // Combine note lines into notes
  if (noteLines.length > 0) result.notes = noteLines.join(', ')

  // --- Extract model from the brand+model line ---
  if (modelLine) {
    let model = modelLine
    // Strip brand name
    const brandIdx = model.toLowerCase().indexOf(result.brand.toLowerCase())
    if (brandIdx !== -1) {
      model = model.slice(brandIdx + result.brand.length).trim()
    } else {
      // Try abbreviation
      for (const [brand, re] of Object.entries(abbreviations)) {
        if (brand === result.brand) {
          const m = model.match(re)
          if (m) { model = model.slice(m.index + m[0].length).trim(); break }
        }
      }
    }
    // Strip inline price if present
    model = model.replace(/[€$]\s*[\d,.]+/g, '').trim()
    // Strip condition/scope keywords if on the same line
    model = model.replace(/\b(pre-owned|minor|major|fair|needs?\s*repair|repaired|card\s*[&+]\s*box|with\s+card|with\s+box|watch\s+only)\b.*/gi, '').trim()
    model = model.replace(/^[\s,\-·]+|[\s,\-·]+$/g, '')

    // Use the code to look up model name (don't auto-fill reference/SKU field)
    const refMatch = model.match(/\b([A-Z0-9][A-Z0-9.\-/]{3,}[A-Z0-9])\b/i)
    if (refMatch) {
      // Look up model name from reference database
      const ref = refMatch[0]
      const refClean = ref.replace(/-/g, '')
      // Strip variant suffix: 126158-0012 → 126158, also try without dashes
      const refBase = ref.split('-')[0]
      const looked = WATCH_REFS[ref] || WATCH_REFS[refClean] || WATCH_REFS[refBase]
        // Try with common prefixes stripped or added (e.g. Q3838420 ↔ 3838420, PAM00111 ↔ 111)
        || Object.entries(WATCH_REFS).find(([k]) => k.endsWith(refClean) || k.endsWith(refBase) || refClean.endsWith(k.replace(/^[A-Z]+/, '')))?.[1]
        // Try partial match: ref starts with or is contained in a key
        || Object.entries(WATCH_REFS).find(([k]) => ref.startsWith(k) || refBase.startsWith(k) || k.includes(refBase))?.[1]
      if (looked) {
        // Model name + full reference: "Daytona 126518-0012"
        result.model = `${looked} ${ref}`
        return result
      }
    }

    // No lookup found — use the raw text as model (includes the ref code)
    if (model) result.model = model
  }

  // --- Category detection ---
  const brandLower = result.brand.toLowerCase()
  if (/\bbag\b|\bbirkin\b|\bkelly\b|\bneverfull\b|\bspeedy\b|\btote\b|\bclutch\b/i.test(fullText)) {
    result.category = 'Bags'
  } else if (/\bjewel|\bring\b|\bbracelet\b|\bnecklace\b|\bearring|\bpendant/i.test(fullText) || JEWELLERY_BRANDS.has(brandLower)) {
    result.category = 'Jewellery'
  } else {
    result.category = 'Watches'
  }
  if (['rolex','audemars piguet','patek philippe','omega','iwc','jaeger-lecoultre','breitling','tag heuer','tudor','hublot','richard mille','vacheron constantin','a. lange & söhne','panerai','blancpain','breguet','zenith','grand seiko','ulysse nardin','girard-perregaux'].includes(brandLower)) {
    result.category = 'Watches'
  }

  // Jewellery sub-type
  for (const j of JEWELLERY_TYPE_KEYWORDS) {
    if (j.match.test(fullText)) { result.subcategory = j.value; break }
  }

  return result
}

const EMPTY_FORM = {
  category: 'Watches',
  brand: 'Rolex',
  model: '',
  reference: '',
  condition: 'pre-owned conditions with MINOR signs of usage',
  scope_of_delivery: '',
  price_eur: '',
  cost_eur: '',
  vendor: '',
  notes: '',
  metal_type: '',
  item_size: '',
  subcategory: ''
}

const SUPABASE_URL = 'https://tulqgebsvpxgwocptnmy.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA'

async function notifyOffer(payload) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify(payload)
    })
  } catch (err) {
    console.log('Notify error:', err)
  }
}

async function notifyDealers(watch) {
  try {
    await fetch('https://tulqgebsvpxgwocptnmy.supabase.co/functions/v1/notify-dealers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA'
      },
      body: JSON.stringify({ record: watch })
    })
  } catch (err) {
    console.log('Notify error:', err)
  }
}

export default function AgentListings() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { rate } = useExchangeRate()
  const [tab, setTab] = useState('listings')
  const [watches, setWatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [images, setImages] = useState([])
  const [previews, setPreviews] = useState([])
  const [posting, setPosting] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const { currency } = useCurrency()
  const [search, setSearch] = useState('')
  const [offers, setOffers] = useState([])
  const [offersLoading, setOffersLoading] = useState(false)
  const [counterInputs, setCounterInputs] = useState({})
  const [agentComments, setAgentComments] = useState({})
  const [counterOpen, setCounterOpen] = useState({})
  const [offerStatusTab, setOfferStatusTab] = useState('pending')

  const fetchMyWatches = useCallback(async () => {
    const q = profile?.role === 'admin'
      ? supabase.from('products').select('*, product_images(url, position)').order('created_at', { ascending: false })
      : supabase.from('products').select('*, product_images(url, position)').eq('posted_by', profile?.id).order('created_at', { ascending: false })
    const { data } = await q
    setWatches(data || [])
    setLoading(false)
  }, [profile])

  const fetchOffers = useCallback(async () => {
    setOffersLoading(true)
    const { data, error } = await supabase
      .from('offers')
      .select('*, products(id, brand, model, reference, price_eur, price_usd, product_images(url, position))')
      .order('created_at', { ascending: false })
    if (error) console.error('fetchOffers error:', error)
    setOffers(data || [])
    setOffersLoading(false)
  }, [])

  useEffect(() => { if (profile) fetchMyWatches() }, [profile, fetchMyWatches])
  useEffect(() => { if (profile && tab === 'offers') fetchOffers() }, [profile, tab, fetchOffers])

  function handleField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function handleImages(e) {
    const files = Array.from(e.target.files)
    setImages(files)
    setPreviews(files.map(f => URL.createObjectURL(f)))
  }

  const usdPreview = form.price_eur && rate
    ? '$' + Math.round(Number(form.price_eur) * rate).toLocaleString()
    : null

  async function handlePost(e) {
    e.preventDefault()
    setError('')
    if (!form.brand) { setError('Brand is required.'); return }
    if (!form.model) { setError('Model name is required.'); return }
    // reference is optional for manual entries
    if (!form.condition) { setError('Condition is required.'); return }
    if (!form.price_eur) { setError('Price in EUR is required.'); return }
    if (form.category === 'Watches' && !form.scope_of_delivery) { setError('Scope of delivery is required.'); return }
    if (form.category === 'Jewellery' && !form.subcategory) { setError('Jewellery type is required.'); return }
    if (form.category === 'Jewellery' && !form.metal_type) { setError('Metal type is required.'); return }
    setPosting(true)
    try {
      const priceUsd = rate ? Math.round(Number(form.price_eur) * rate) : null
      const { data: watch, error: wErr } = await supabase.from('products').insert({
        category: form.category,
        brand: form.brand,
        model: form.model,
        reference: form.reference || null,
        condition: form.condition,
        price_eur: Number(form.price_eur),
        price_usd: priceUsd,
        cost_eur: form.cost_eur ? Number(form.cost_eur) : null,
        vendor: form.vendor || null,
        notes: form.notes || null,
        scope_of_delivery: form.scope_of_delivery || null,
        metal_type: form.category === 'Jewellery' && form.metal_type ? form.metal_type : null,
        subcategory: form.category === 'Jewellery' && form.subcategory ? form.subcategory : null,
        item_size: form.category === 'Jewellery' && form.item_size && form.subcategory !== 'Necklaces' ? form.item_size : null,
        posted_by: profile.id,
        source: 'manual',
        status: 'available'
      }).select().single()
      if (wErr) throw wErr

      for (let i = 0; i < images.length; i++) {
        const file = images[i]
        const ext = file.name.split('.').pop()
        const path = `${watch.id}/${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('watch-images').upload(path, file)
        if (upErr) continue
        const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path)
        await supabase.from('product_images').insert({ product_id: watch.id, url: publicUrl, position: i })
      }

      notifyDealers(watch)

      setForm(EMPTY_FORM)
      setImages([])
      setPreviews([])
      setMsg('Item posted — now live in the dealer catalog.')
      setTab('listings')
      fetchMyWatches()
    } catch (err) {
      console.error('Post error:', err)
      setError(err?.message || 'Something went wrong. Please try again.')
    }
    setPosting(false)
  }

  async function handleAcceptOffer(offer) {
    if (agentComments[offer.id]) {
      await supabase.from('offers').update({ agent_comment: agentComments[offer.id] }).eq('id', offer.id)
    }
    const { error } = await supabase.rpc('accept_offer', { offer_id: offer.id })
    if (error) console.error('accept_offer error:', error)
    notifyOffer({
      action: 'accepted',
      watch: offer.products,
      dealer_whatsapp: offer.dealer_whatsapp,
      offer_price: offer.offer_price,
      agent_comment: agentComments[offer.id] || null,
    })
    setMsg(`Offer accepted for ${offer.products.brand} ${offer.products.model}.`)
    fetchOffers()
  }

  async function handleRejectOffer(offer) {
    await supabase.from('offers').update({ status: 'rejected', agent_comment: agentComments[offer.id] || null, updated_at: new Date().toISOString() }).eq('id', offer.id)
    notifyOffer({
      action: 'rejected',
      watch: offer.products,
      dealer_whatsapp: offer.dealer_whatsapp,
      offer_price: offer.offer_price,
      agent_comment: agentComments[offer.id] || null,
    })
    setMsg(`Offer rejected for ${offer.products.brand} ${offer.products.model}.`)
    fetchOffers()
  }

  async function handleCounterOffer(offer) {
    const counterPrice = counterInputs[offer.id]
    if (!counterPrice) return
    await supabase.from('offers').update({
      status: 'countered',
      counter_price: Number(counterPrice),
      agent_comment: agentComments[offer.id] || null,
      updated_at: new Date().toISOString()
    }).eq('id', offer.id)
    notifyOffer({
      action: 'countered',
      watch: offer.products,
      dealer_whatsapp: offer.dealer_whatsapp,
      dealer_name: 'Dealer',
      counter_price: Number(counterPrice),
      agent_comment: agentComments[offer.id] || null,
    })
    setMsg(`Counter offer sent for ${offer.products.brand} ${offer.products.model}.`)
    setCounterOpen(prev => ({ ...prev, [offer.id]: false }))
    fetchOffers()
  }

  async function markSold(id) {
    await supabase.from('products').update({ status: 'sold' }).eq('id', id)
    fetchMyWatches()
  }

  async function deleteWatch(id) {
    if (!window.confirm('Delete this item?')) return
    await supabase.from('products').delete().eq('id', id)
    fetchMyWatches()
  }

  function fmtPrice(w) {
    if (currency === 'USD') {
      if (w.price_usd) return '$' + Number(w.price_usd).toLocaleString()
      if (w.price_eur && rate) return '$' + Math.round(Number(w.price_eur) * rate).toLocaleString()
      return '—'
    }
    if (w.price_eur) return '€' + Number(w.price_eur).toLocaleString()
    return '—'
  }

  function getThumb(w) {
    const imgs = [...(w.product_images || [])].sort((a, b) => a.position - b.position)
    return imgs[0]?.url || null
  }

  const q = search.toLowerCase()
  const filteredWatches = watches.filter(w =>
    !search || w.brand?.toLowerCase().includes(q) || w.model?.toLowerCase().includes(q) || w.reference?.toLowerCase().includes(q)
  )

  return (
    <div className="page">
      <Topbar />
      <div className="tabs">
        <div className={`tab ${tab === 'listings' ? 'active' : ''}`} onClick={() => setTab('listings')}>My listings</div>
        <div className={`tab ${tab === 'post' ? 'active' : ''}`} onClick={() => setTab('post')}>Post new item</div>
        <div className={`tab ${tab === 'offers' ? 'active' : ''}`} onClick={() => setTab('offers')}>
          Offers{offers.filter(o => o.status === 'pending').length > 0 && (
            <span style={{ marginLeft: 6, background: '#b8965a', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>
              {offers.filter(o => o.status === 'pending').length}
            </span>
          )}
        </div>
      </div>

      {tab === 'listings' && (
        <div style={{ padding: 16 }}>
          {msg && <div className="success-msg" style={{ marginBottom: 12 }}>{msg}</div>}
          <input
            placeholder="Search brand, model or reference..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 12, boxSizing: 'border-box' }}
          />
          {loading
            ? <div className="loading-page" style={{ minHeight: 200 }}><div className="spinner" /></div>
            : filteredWatches.length === 0
              ? <div className="empty-state">{search ? 'No items match your search' : 'No items posted yet'}</div>
              : filteredWatches.map(w => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid #e8e5e0', borderRadius: 10, marginBottom: 8, background: '#fff' }}>
                <div onClick={() => navigate(`/catalog/${w.id}`)} style={{ width: 50, height: 50, borderRadius: 8, background: '#f7f6f3', border: '1px solid #e8e5e0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                  {getThumb(w) ? <img src={getThumb(w)} alt={w.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 20 }}>⌚</span>}
                </div>
                <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => navigate(`/catalog/${w.id}`)}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{w.brand} {w.model}</div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>{fmtPrice(w)} · {w.condition}{w.reference ? ` · ${w.reference}` : ''}{w.category ? ` · ${w.category}` : ''}</div>
                </div>
                <span className={`badge badge-${w.status}`}>{w.status}</span>
                <button className="btn btn-sm" onClick={() => navigate(`/catalog/${w.id}`)}>Edit</button>
                {w.status !== 'sold' && (
                  <button className="btn btn-sm" onClick={() => markSold(w.id)}>Mark sold</button>
                )}
                {(profile?.role === 'admin' || w.posted_by === profile?.id) && (
                  <button className="btn btn-sm btn-danger" onClick={() => deleteWatch(w.id)}>Delete</button>
                )}
              </div>
            ))
          }
        </div>
      )}

      {tab === 'offers' && (
        <div style={{ padding: 16, maxWidth: 700 }}>
          {msg && <div className="success-msg" style={{ marginBottom: 12 }}>{msg}</div>}
          <div className="tabs" style={{ marginBottom: 16 }}>
            {['pending', 'countered', 'accepted', 'rejected'].map(s => {
              const count = offers.filter(o => o.status === s).length
              const badgeColor = s === 'pending' ? '#e6a817' : s === 'countered' ? '#b8965a' : s === 'accepted' ? '#2e7d32' : '#c62828'
              return (
                <div key={s} className={`tab ${offerStatusTab === s ? 'active' : ''}`} onClick={() => setOfferStatusTab(s)} style={{ textTransform: 'capitalize' }}>
                  {s}{count > 0 && <span style={{ marginLeft: 5, background: badgeColor, color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>{count}</span>}
                </div>
              )
            })}
          </div>
          {offersLoading
            ? <div className="loading-page" style={{ minHeight: 200 }}><div className="spinner" /></div>
            : offers.filter(o => o.status === offerStatusTab).length === 0
              ? <div className="empty-state">No {offerStatusTab} offers</div>
              : offers.filter(o => o.status === offerStatusTab).map(offer => {
                const watch = offer.products
                const imgs = [...(watch?.product_images || [])].sort((a, b) => a.position - b.position)
                const thumb = imgs[0]?.url || null
                const STATUS_COLOR = { pending: '#e6a817', countered: '#b8965a', accepted: '#2e7d32', rejected: '#c62828' }
                return (
                  <div key={offer.id} style={{ border: '1px solid #e8e5e0', borderRadius: 12, padding: 16, marginBottom: 12, background: '#fff' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div
                        onClick={() => navigate(`/catalog/${watch.id}`)}
                        style={{ width: 52, height: 52, borderRadius: 8, background: '#f7f6f3', border: '1px solid #e8e5e0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
                      >
                        {thumb ? <img src={thumb} alt={watch.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 20 }}>⌚</span>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} onClick={() => navigate(`/catalog/${watch.id}`)}>
                              {watch.brand} {watch.model}
                            </div>
                            <div style={{ fontSize: 11, color: '#aaa' }}>{offer.dealer_whatsapp ? `WA: ${offer.dealer_whatsapp}` : 'Dealer'}</div>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[offer.status] || '#888', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
                            {offer.status}
                          </span>
                        </div>

                        <div style={{ marginTop: 10, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Listing price</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#888' }}>{watch?.price_eur ? `€${Number(watch.price_eur).toLocaleString()}` : '—'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Offer</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>€{Number(offer.offer_price).toLocaleString()}</div>
                          </div>
                          {offer.counter_price && (
                            <div>
                              <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your counter</div>
                              <div style={{ fontSize: 15, fontWeight: 600, color: '#b8965a' }}>€{Number(offer.counter_price).toLocaleString()}</div>
                            </div>
                          )}
                        </div>

                        {offer.dealer_comment && (
                          <div style={{ marginTop: 8, fontSize: 12, color: '#555', background: '#f8f6f2', borderRadius: 6, padding: '6px 10px' }}>
                            <span style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Dealer · </span>
                            {offer.dealer_comment}
                          </div>
                        )}
                        {offer.agent_comment && (
                          <div style={{ marginTop: 6, fontSize: 12, color: '#555', background: '#f0efe9', borderRadius: 6, padding: '6px 10px' }}>
                            <span style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Your note · </span>
                            {offer.agent_comment}
                          </div>
                        )}

                        {(offer.status === 'pending' || offer.status === 'countered') && (
                          <div style={{ marginTop: 10 }}>
                            <div className="form-row" style={{ marginBottom: 6 }}>
                              <input
                                placeholder="Add a note (optional)"
                                value={agentComments[offer.id] || ''}
                                onChange={e => setAgentComments(prev => ({ ...prev, [offer.id]: e.target.value }))}
                                style={{ fontSize: 12 }}
                              />
                            </div>
                            {counterOpen[offer.id] ? (
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                  type="number"
                                  placeholder="Counter price (€)"
                                  value={counterInputs[offer.id] || ''}
                                  onChange={e => setCounterInputs(prev => ({ ...prev, [offer.id]: e.target.value }))}
                                  style={{ width: 160, fontSize: 13 }}
                                />
                                <button className="btn btn-sm btn-dark" onClick={() => handleCounterOffer(offer)} disabled={!counterInputs[offer.id]}>Send Counter</button>
                                <button className="btn btn-sm" onClick={() => setCounterOpen(prev => ({ ...prev, [offer.id]: false }))}>Cancel</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className="btn btn-sm btn-green" onClick={() => handleAcceptOffer(offer)}>Accept</button>
                                <button className="btn btn-sm" style={{ color: '#c00', borderColor: '#f09595' }} onClick={() => handleRejectOffer(offer)}>Reject</button>
                                <button className="btn btn-sm" onClick={() => setCounterOpen(prev => ({ ...prev, [offer.id]: true }))}>Counter</button>
                              </div>
                            )}
                          </div>
                        )}

                        <div style={{ marginTop: 8, fontSize: 10, color: '#bbb' }}>
                          {new Date(offer.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {offer.dealer_whatsapp && <span> · WA: {offer.dealer_whatsapp}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
          }
        </div>
      )}

      {tab === 'post' && (
        <div style={{ padding: 16, maxWidth: 600 }}>
          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={handlePost}>
            <label className="upload-zone" htmlFor="img-upload">
              {previews.length > 0
                ? <div className="thumb-row">{previews.map((p, i) => <img key={i} src={p} alt="" className="thumb" />)}</div>
                : <div>Tap to upload photos<br /><span style={{ fontSize: 11, color: '#bbb' }}>JPG, PNG — multiple allowed</span></div>
              }
              <input id="img-upload" type="file" accept="image/*" multiple onChange={handleImages} />
            </label>

            <div style={{ marginBottom: 16, background: '#f8f6f2', borderRadius: 12, padding: 16, border: '1px solid #e6e0d8' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Quick Post</div>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>Paste all info in one go — brand, model, price, condition — and the form fills automatically.</div>
              <textarea
                rows={3}
                placeholder='e.g. Rolex Daytona 116500LN €35,000 minor Card & Box'
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 13 }}
                onChange={async e => {
                  const parsed = parseQuickPost(e.target.value)
                  // If reference found but no model from static map, try DB lookup
                  if (parsed.reference && (!parsed.model || parsed.model === parsed.reference)) {
                    const { data } = await supabase.from('products').select('model').ilike('reference', `%${parsed.reference}%`).limit(1).single()
                    if (data?.model) parsed.model = data.model
                  }
                  setForm(f => {
                    const updated = { ...f }
                    if (parsed.brand !== 'Rolex' || !f.brand) updated.brand = parsed.brand
                    if (parsed.model) updated.model = parsed.model
                    // reference/SKU left empty — agent fills manually if needed
                    if (parsed.price_eur) updated.price_eur = parsed.price_eur
                    if (parsed.condition !== EMPTY_FORM.condition) updated.condition = parsed.condition
                    if (parsed.category) updated.category = parsed.category
                    if (parsed.scope_of_delivery) updated.scope_of_delivery = parsed.scope_of_delivery
                    if (parsed.metal_type) updated.metal_type = parsed.metal_type
                    if (parsed.subcategory) updated.subcategory = parsed.subcategory
                    if (parsed.cost_eur) updated.cost_eur = parsed.cost_eur
                    if (parsed.vendor) updated.vendor = parsed.vendor
                    if (parsed.notes) updated.notes = parsed.notes
                    return updated
                  })
                }}
              />
            </div>

            <div className="form-row">
              <label>Category</label>
              <select value={form.category} onChange={e => handleField('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-2col">
              <div className="form-row">
                <label>Brand</label>
                <select value={form.brand} onChange={e => handleField('brand', e.target.value)}>
                  {BRANDS.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Condition</label>
                <select value={form.condition} onChange={e => handleField('condition', e.target.value)}>
                  {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <label>Model name</label>
              <input value={form.model} onChange={e => handleField('model', e.target.value)} placeholder="e.g. Daytona, Birkin, Love Bracelet" required />
            </div>

            {form.category === 'Jewellery' && (
              <>
                <div className="form-row">
                  <label>Jewellery type</label>
                  <select value={form.subcategory} onChange={e => { handleField('subcategory', e.target.value); handleField('item_size', '') }}>
                    <option value="">Select type</option>
                    <option>Rings</option>
                    <option>Bracelets</option>
                    <option>Necklaces</option>
                    <option>Earrings</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Metal type</label>
                  <select value={form.metal_type} onChange={e => handleField('metal_type', e.target.value)}>
                    <option value="">Select metal</option>
                    <option>Yellow Gold</option>
                    <option>Pink Gold</option>
                    <option>White Gold</option>
                    <option>Platinum</option>
                  </select>
                </div>
                {form.subcategory === 'Rings' && (
                  <div className="form-row">
                    <label>Ring size</label>
                    <select value={form.item_size} onChange={e => handleField('item_size', e.target.value)}>
                      <option value="">Select size</option>
                      {['50','51','52','53','54','55','56','57','58','59','60','61','62','63','64','65'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {form.subcategory === 'Bracelets' && (
                  <div className="form-row">
                    <label>Bracelet size</label>
                    <select value={form.item_size} onChange={e => handleField('item_size', e.target.value)}>
                      <option value="">Select size</option>
                      {['14','15','16','17','18','19','20','21','22','23','XS','S','M','L','XL','XXL','3XL'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}


            {form.category === 'Watches' && (
              <div className="form-row">
                <label>Scope of Delivery</label>
                <select value={form.scope_of_delivery || ''} onChange={e => handleField('scope_of_delivery', e.target.value)} required>
                  <option value="">Select scope</option>
                  <option>Watch Only</option>
                  <option>With Card</option>
                  <option>With Box</option>
                  <option>Card & Box</option>
                </select>
              </div>
            )}

            <div className="form-2col">
              <div className="form-row">
                <label>Selling Price (€ EUR)</label>
                <input type="number" value={form.price_eur} onChange={e => handleField('price_eur', e.target.value)} placeholder="e.g. 35000" required />
                {usdPreview && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>≈ {usdPreview} USD</div>
                )}
              </div>
              <div className="form-row">
                <label>Cost Price (€ EUR)</label>
                <input type="number" value={form.cost_eur} onChange={e => handleField('cost_eur', e.target.value)} placeholder="e.g. 28000" />
              </div>
            </div>

            <div className="form-row">
              <label>Vendor</label>
              <input value={form.vendor} onChange={e => handleField('vendor', e.target.value)} placeholder="e.g. c713671" />
            </div>

            <div className="form-row">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => handleField('notes', e.target.value)} rows={3} placeholder="Box & papers, year, condition details..." />
            </div>

            <button type="submit" className="btn btn-dark btn-full" disabled={posting}>
              {posting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Post to catalog'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
