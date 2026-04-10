import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useExchangeRate } from '../hooks/useExchangeRate'
import { useCurrency } from '../context/CurrencyContext'
import Topbar from '../components/Topbar'

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

  // Extract price (€ or $ followed by numbers, or just large numbers)
  const priceMatch = text.match(/[€$]\s*([\d,.]+)/i) || text.match(/(\d{1,3}(?:[.,]\d{3})+)/i) || text.match(/\b(\d{4,})\b/)
  if (priceMatch) {
    result.price_eur = priceMatch[1].replace(/[.,]/g, m => m === '.' && priceMatch[1].indexOf('.') !== priceMatch[1].lastIndexOf('.') ? '' : m).replace(/,/g, '')
    // Clean: remove all dots if multiple (thousand separators), keep last dot if decimal
    const raw = priceMatch[1].replace(/\s/g, '')
    const dots = (raw.match(/\./g) || []).length
    const commas = (raw.match(/,/g) || []).length
    if (dots > 1 || (dots === 1 && commas > 0)) result.price_eur = raw.replace(/[.,]/g, '')
    else if (commas > 1) result.price_eur = raw.replace(/,/g, '')
    else if (commas === 1 && raw.indexOf(',') > raw.length - 4) result.price_eur = raw.replace(',', '.')
    else result.price_eur = raw.replace(/,/g, '')
    result.price_eur = String(Math.round(Number(result.price_eur)))
  }

  // Detect brand (longest match first)
  const sortedBrands = [...BRANDS].sort((a, b) => b.length - a.length)
  const textLower = text.toLowerCase()
  for (const brand of sortedBrands) {
    if (textLower.includes(brand.toLowerCase())) {
      result.brand = brand
      break
    }
  }
  // Also try common abbreviations
  if (result.brand === 'Rolex') { /* default, check others */ }
  if (/\bAP\b/.test(text)) result.brand = 'Audemars Piguet'
  if (/\bPP\b/.test(text)) result.brand = 'Patek Philippe'
  if (/\bVC\b/.test(text) || /\bvacheron\b/i.test(text)) result.brand = 'Vacheron Constantin'
  if (/\bJLC\b/.test(text)) result.brand = 'Jaeger-LeCoultre'
  if (/\bRM\b/.test(text)) result.brand = 'Richard Mille'
  if (/\bVCA\b/.test(text)) result.brand = 'Van Cleef & Arpels'
  if (/\bLV\b/.test(text)) result.brand = 'Louis Vuitton'

  // Detect category from brand or keywords
  const brandLower = result.brand.toLowerCase()
  if (/\bbag\b|\bbirkin\b|\bkelly\b|\bneverfull\b|\bspeedy\b|\btote\b|\bclutch\b/i.test(text)) {
    result.category = 'Bags'
  } else if (/\bjewel|\bring\b|\bbracelet\b|\bnecklace\b|\bearring|\bpendant/i.test(text) || JEWELLERY_BRANDS.has(brandLower)) {
    result.category = 'Jewellery'
  } else {
    result.category = 'Watches'
  }
  // If a known watch brand override back
  if (['rolex','audemars piguet','patek philippe','omega','iwc','jaeger-lecoultre','breitling','tag heuer','tudor','hublot','richard mille','vacheron constantin','a. lange & söhne','panerai','blancpain','breguet','zenith','grand seiko','ulysse nardin','girard-perregaux'].includes(brandLower)) {
    result.category = 'Watches'
  }

  // Condition
  if (/\bmajor\b/i.test(text)) result.condition = 'pre-owned conditions with MAJOR signs of usage'
  else if (/\bminor\b/i.test(text)) result.condition = 'pre-owned conditions with MINOR signs of usage'
  else if (/\bneed[s]?\s*repair/i.test(text)) result.condition = 'Needs Repair'
  else if (/\brepair.*albania/i.test(text)) result.condition = 'Repaired Albania'
  else if (/\brepaired\b/i.test(text)) result.condition = 'Repaired'
  else if (/\bfair\b/i.test(text)) result.condition = 'Fair'

  // Scope of delivery
  for (const s of SCOPE_KEYWORDS) {
    if (s.match.test(text)) { result.scope_of_delivery = s.value; break }
  }

  // Metal type (jewellery)
  for (const m of METAL_KEYWORDS) {
    if (m.match.test(text)) { result.metal_type = m.value; break }
  }

  // Jewellery sub-type
  for (const j of JEWELLERY_TYPE_KEYWORDS) {
    if (j.match.test(text)) { result.subcategory = j.value; break }
  }

  // Find where the brand appears in the text (full name or abbreviation)
  const abbreviations = { 'Audemars Piguet': /\bAP\b/i, 'Patek Philippe': /\bPP\b/i, 'Vacheron Constantin': /\bVC\b|\bvacheron\b/i, 'Jaeger-LeCoultre': /\bJLC\b/i, 'Richard Mille': /\bRM\b/i, 'Van Cleef & Arpels': /\bVCA\b/i, 'Louis Vuitton': /\bLV\b/i }
  let afterBrand = text
  // Try full brand name first
  const brandPos = textLower.indexOf(result.brand.toLowerCase())
  if (brandPos !== -1) {
    afterBrand = text.slice(brandPos + result.brand.length).trim()
  } else if (abbreviations[result.brand]) {
    // Try abbreviation
    const abbrMatch = text.match(abbreviations[result.brand])
    if (abbrMatch) afterBrand = text.slice(abbrMatch.index + abbrMatch[0].length).trim()
  }

  // Stop at price, condition, or scope keywords
  const stopPatterns = /[€$]\s*[\d]|\b\d{4,}\b(?!\w)|\b(minor|major|fair|needs?\s*repair|repaired|card\s*[&+]\s*box|with\s+card|with\s+box|watch\s+only|yellow\s*gold|pink\s*gold|rose\s*gold|white\s*gold|platinum)\b/i
  const stopMatch = afterBrand.search(stopPatterns)
  let modelPart = stopMatch > 0 ? afterBrand.slice(0, stopMatch).trim() : afterBrand.replace(/[€$]\s*[\d,.\s]+/g, '').trim()
  // Clean up any trailing/leading junk
  modelPart = modelPart.replace(/^[\s,\-·]+|[\s,\-·]+$/g, '')

  // Extract reference from model part (alphanumeric code like 116500LN, 15400ST, Q9038180)
  const refMatch = modelPart.match(/\b([A-Z0-9]{4,}[A-Z0-9./\-]*)\b/i)
  if (refMatch) result.reference = refMatch[1]

  if (modelPart) result.model = modelPart

  return result
}

const EMPTY_FORM = {
  category: 'Watches',
  brand: 'Rolex',
  model: '',
  reference: '',
  condition: 'pre-owned conditions with MINOR signs of usage',
  price_eur: '',
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
    if (!form.model) { setError('Model name is required.'); return }
    if (!form.price_eur) { setError('Price in EUR is required.'); return }
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
        notes: form.notes || null,
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
      setError('Something went wrong. Please try again.')
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
                onChange={e => {
                  const parsed = parseQuickPost(e.target.value)
                  setForm(f => {
                    const updated = { ...f }
                    if (parsed.brand !== 'Rolex' || !f.brand) updated.brand = parsed.brand
                    if (parsed.model) updated.model = parsed.model
                    if (parsed.reference) updated.reference = parsed.reference
                    if (parsed.price_eur) updated.price_eur = parsed.price_eur
                    if (parsed.condition !== EMPTY_FORM.condition) updated.condition = parsed.condition
                    if (parsed.category) updated.category = parsed.category
                    if (parsed.scope_of_delivery) updated.scope_of_delivery = parsed.scope_of_delivery
                    if (parsed.metal_type) updated.metal_type = parsed.metal_type
                    if (parsed.subcategory) updated.subcategory = parsed.subcategory
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

            <div className="form-row">
              <label>Reference / Serial</label>
              <input value={form.reference} onChange={e => handleField('reference', e.target.value)} placeholder="e.g. 116500LN" />
            </div>

            <div className="form-row">
              <label>Price (€ EUR)</label>
              <input type="number" value={form.price_eur} onChange={e => handleField('price_eur', e.target.value)} placeholder="e.g. 35000" required />
              {usdPreview && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>≈ {usdPreview} USD <span style={{ color: '#bbb' }}>(live rate)</span></div>
              )}
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
