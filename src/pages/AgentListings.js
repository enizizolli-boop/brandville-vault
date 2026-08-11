import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { supabase } from '../lib/supabase'
import { toSlug } from '../lib/slug'
import { useAuth } from '../context/AuthContext'
import { useExchangeRate } from '../hooks/useExchangeRate'
import { useCurrency } from '../context/CurrencyContext'
import Topbar from '../components/Topbar'
import Footer from '../components/Footer'
import WATCH_REFS from '../data/watchRefs'

const CATEGORIES = ['Watches', 'Jewellery', 'Bags']

const CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair',
  'Needs Repair',
  'Repaired',
  'Repaired Albania',
  'Pre-owned',
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
  let brandFoundInText = false
  for (const brand of sortedBrands) {
    if (fullLower.includes(brand.toLowerCase())) { result.brand = brand; brandFoundInText = true; break }
  }
  const abbreviations = { 'Audemars Piguet': /\bAP\b/, 'Patek Philippe': /\bPP\b/, 'Vacheron Constantin': /\bVC\b/i, 'Jaeger-LeCoultre': /\bJLC\b/, 'Richard Mille': /\bRM\b/, 'Van Cleef & Arpels': /\bVCA\b/, 'Louis Vuitton': /\bLV\b/ }
  for (const [brand, re] of Object.entries(abbreviations)) {
    if (re.test(fullText)) { result.brand = brand; brandFoundInText = true; break }
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
      const eurMatch = line.match(/([\d]['\d,.\s]*[\d])\s*€/)
      const parsed = eurMatch ? parsePrice(eurMatch[0]) : parsePrice(line)
      if (!result.price_eur) result.price_eur = parsed
      else if (!result.cost_eur) result.cost_eur = parsed
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
      const yearMatch = line.match(/\b((?:19|20)\d{2})\b/)
      if (yearMatch) noteLines.push(yearMatch[1])
      continue
    }

    // Vendor line → only treat as keyword if followed by colon (e.g. "Vendor: John", "WeChat: c713671")
    if (/\b(?:vendor|wechat):/i.test(lineLower)) {
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

    // First unmatched line → brand + model only if brand was in text; otherwise → vendor
    if (!modelLine && brandFoundInText) modelLine = line
    else if (!result.vendor) result.vendor = line
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
  condition: 'Pre-owned',
  scope_of_delivery: '',
  price_eur: '',
  cost_eur: '',
  vendor: '',
  notes: '',
  metal_type: '',
  item_size: '',
  subcategory: '',
  is_preorder: false
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
  const navigate = useNav()
  const location = useLocation()
  const { rate } = useExchangeRate()
  const { rate: cnyToEurRate } = useExchangeRate('CNY', 'EUR')
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('tab') || 'listings'
  })

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const t = params.get('tab')
    if (t) setTab(t)
  }, [location.search])
  const [bagName, setBagName] = useState('')
  const [bagCostPrice, setBagCostPrice] = useState('')
  const [bagCostCurrency, setBagCostCurrency] = useState('EUR')
  const [bagSellingPrice, setBagSellingPrice] = useState('')
  const [bagPosting, setBagPosting] = useState(false)
  const [bagMsg, setBagMsg] = useState('')
  const [bagError, setBagError] = useState('')
  const [bagImages, setBagImages] = useState([])
  const [bagPreviews, setBagPreviews] = useState([])
  const [bagDragIndex, setBagDragIndex] = useState(null)
  const [bagIsPreorder, setBagIsPreorder] = useState(false)
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
  const [preorders, setPreorders] = useState([])
  const [listingType, setListingType] = useState('instock')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [preorderStatusFilter, setPreorderStatusFilter] = useState('all')
  const [preorderBrandFilter, setPreorderBrandFilter] = useState('all')
  const [preorderPriceMin, setPreorderPriceMin] = useState('')
  const [preorderPriceMax, setPreorderPriceMax] = useState('')
  const [preorderSort, setPreorderSort] = useState('newest')
  const [clients, setClients] = useState([])
  const [pendingTokens, setPendingTokens] = useState([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [generatedLink, setGeneratedLink] = useState('')
  const [generating, setGenerating] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [copied, setCopied] = useState('')
  const [supplierListings, setSupplierListings] = useState([])
  const [supReviewData, setSupReviewData] = useState({}) // { [id]: { price, reason } }
  const [supEditId, setSupEditId] = useState(null)
  const [supEditForm, setSupEditForm] = useState({})
  const [listingsOpen, setListingsOpen] = useState(true)
  const [activityOpen, setActivityOpen] = useState(true)
  const [inStockBrand, setInStockBrand] = useState('all')
  const [inStockCondition, setInStockCondition] = useState('all')
  const [inStockStatus, setInStockStatus] = useState('all')
  const [inStockSortBy, setInStockSortBy] = useState('newest')
  const [viewMode, setViewMode] = useState('list')

  const fetchSupplierListings = useCallback(async () => {
    const { data } = await supabase
      .from('supplier_listings')
      .select('*, supplier_listing_images(url, position), profiles!supplier_id(full_name, phone)')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
    setSupplierListings(data || [])
  }, [])

  const fetchMyWatches = useCallback(async () => {
    const q = profile?.role === 'admin'
      ? supabase.from('products').select('*, product_images(url, position)').order('created_at', { ascending: false })
      : supabase.from('products').select('*, product_images(url, position)').eq('posted_by', profile?.id).order('created_at', { ascending: false })
    const { data } = await q
    setWatches(data || [])
    setLoading(false)
  }, [profile])

  const fetchPreorders = useCallback(async () => {
    const q = supabase.from('preorders').select('*, preorder_images(url, position)').order('created_at', { ascending: false })
    const { data } = await q
    setPreorders(data || [])
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

  const fetchClients = useCallback(async () => {
    if (!profile?.id) return
    setClientsLoading(true)
    const [{ data: dealers }, { data: tokens }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, phone, created_at').eq('invited_by', profile.id).order('created_at', { ascending: false }),
      supabase.from('invite_tokens').select('id, token, created_at').eq('created_by', profile.id).eq('used', false).order('created_at', { ascending: false })
    ])
    setClients(dealers || [])
    setPendingTokens(tokens || [])
    setClientsLoading(false)
  }, [profile])

  async function handleGenerateLink() {
    setLinkError(''); setGenerating(true)
    const tokenBytes = new Uint8Array(20)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('')
    const { error } = await supabase.from('invite_tokens').insert({ token, created_by: profile.id })
    if (error) { setLinkError(error.message); setGenerating(false); return }
    setGeneratedLink(`${window.location.origin}/join/${token}`)
    setGenerating(false)
    fetchClients()
  }

  async function handleRevokeToken(id) {
    await supabase.from('invite_tokens').delete().eq('id', id)
    fetchClients()
    setGeneratedLink(prev => prev) // keep shown link as-is
  }

  function handleCopy(text, key) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  useEffect(() => { if (profile) { fetchMyWatches(); fetchPreorders() } }, [profile, fetchMyWatches, fetchPreorders])
  useEffect(() => { if (profile && tab === 'offers') fetchOffers() }, [profile, tab, fetchOffers])
  useEffect(() => { if (profile && tab === 'clients') fetchClients() }, [profile, tab, fetchClients])
  useEffect(() => { if (profile && tab === 'supplier') fetchSupplierListings() }, [profile, tab, fetchSupplierListings])

  async function approveSupplierListing(listing) {
    const rd = supReviewData[listing.id] || {}
    if (!rd.price) { alert('Set a selling price before approving.'); return }
    if (!window.confirm(`Approve and publish as preorder at €${rd.price}?`)) return
    const { data: preorder, error: pErr } = await supabase.from('preorders').insert({
      brand: listing.brand,
      model: listing.model,
      reference: listing.reference || null,
      condition: listing.condition || 'Pre-owned',
      scope_of_delivery: listing.scope_of_delivery || null,
      notes: listing.notes || null,
      price_eur: Number(rd.price),
      category: 'Watches',
      posted_by: profile.id,
      status: 'available',
    }).select().single()
    if (pErr) { alert('Failed to create preorder: ' + pErr.message); return }
    const imgs = (listing.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    for (const img of imgs) {
      await supabase.from('preorder_images').insert({ preorder_id: preorder.id, url: img.url, position: img.position })
    }
    await supabase.from('supplier_listings').update({
      status: 'approved',
      selling_price: Number(rd.price),
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      preorder_id: preorder.id,
    }).eq('id', listing.id)
    fetchSupplierListings()
    fetchPreorders()
  }

  async function rejectSupplierListing(listing) {
    const rd = supReviewData[listing.id] || {}
    if (!rd.reason) { alert('Add a rejection reason before rejecting.'); return }
    if (!window.confirm('Reject this listing?')) return
    await supabase.from('supplier_listings').update({
      status: 'rejected',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: rd.reason,
    }).eq('id', listing.id)
    fetchSupplierListings()
  }

  function enterSupEdit(listing) {
    setSupEditId(listing.id)
    setSupEditForm({
      brand: listing.brand || '',
      model: listing.model || '',
      reference: listing.reference || '',
      condition: listing.condition || '',
      scope_of_delivery: listing.scope_of_delivery || '',
      asking_price: listing.asking_price || '',
      notes: listing.notes || '',
    })
  }

  async function saveSupplierListingEdit(listingId) {
    const { error } = await supabase
      .from('supplier_listings')
      .update({
        brand: supEditForm.brand,
        model: supEditForm.model,
        reference: supEditForm.reference || null,
        condition: supEditForm.condition || null,
        scope_of_delivery: supEditForm.scope_of_delivery || null,
        asking_price: supEditForm.asking_price ? Number(supEditForm.asking_price) : null,
        notes: supEditForm.notes || null,
      })
      .eq('id', listingId)
    if (error) { alert('Failed to save: ' + error.message); return }
    setSupEditId(null)
    fetchSupplierListings()
  }

  function handleField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function handleImages(e) {
    const files = Array.from(e.target.files)
    setImages(files)
    setPreviews(files.map(f => URL.createObjectURL(f)))
  }

  function handleBagImages(e) {
    const files = Array.from(e.target.files)
    setBagImages(prev => [...prev, ...files])
    setBagPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))])
    e.target.value = ''
  }

  function reorderBagImages(from, to) {
    if (from === null || from === to) return
    setBagImages(arr => { const copy = [...arr]; const [moved] = copy.splice(from, 1); copy.splice(to, 0, moved); return copy })
    setBagPreviews(arr => { const copy = [...arr]; const [moved] = copy.splice(from, 1); copy.splice(to, 0, moved); return copy })
  }

  function removeBagImage(idx) {
    setBagImages(arr => arr.filter((_, i) => i !== idx))
    setBagPreviews(arr => arr.filter((_, i) => i !== idx))
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
    if (images.length === 0) { setError('At least one photo is required.'); return }
    setPosting(true)
    try {
      const priceUsd = rate ? Math.round(Number(form.price_eur) * rate) : null
      const payload = {
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
        status: 'available',
      }

      if (form.is_preorder) {
        const { data: preorder, error: pErr } = await supabase.from('preorders').insert(payload).select().single()
        if (pErr) throw pErr

        let imagesFailed = 0
        for (let i = 0; i < images.length; i++) {
          const file = images[i]
          const ext = file.name.split('.').pop()
          const path = `${preorder.id}/${i}.${ext}`
          const { error: upErr } = await supabase.storage.from('watch-images').upload(path, file)
          if (upErr) { console.error('Preorder image upload error:', upErr.message); imagesFailed++; continue }
          const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path)
          const { error: dbErr } = await supabase.from('preorder_images').insert({ preorder_id: preorder.id, url: publicUrl, position: i })
          if (dbErr) { console.error('Preorder image DB error:', dbErr.message); imagesFailed++ }
        }

        setForm(EMPTY_FORM)
        setImages([])
        setPreviews([])
        if (imagesFailed > 0) {
          setMsg(`Preorder posted, but ${imagesFailed} image(s) failed to save — open the listing and re-upload them.`)
        } else {
          setMsg('Preorder posted — dealers will be notified.')
        }
        setTab('listings')
        setListingType('preorders-watches')
        fetchPreorders()
      } else {
        const { data: watch, error: wErr } = await supabase.from('products').insert({ ...payload, source: 'manual' }).select().single()
        if (wErr) throw wErr

        for (let i = 0; i < images.length; i++) {
          const file = images[i]
          const ext = file.name.split('.').pop()
          const path = `${watch.id}/${i}.${ext}`
          const { error: upErr } = await supabase.storage.from('watch-images').upload(path, file)
          if (upErr) { console.error('Storage upload error:', upErr.message); throw new Error(`Image upload failed: ${upErr.message}`) }
          const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path)
          const { error: imgErr } = await supabase.from('product_images').insert({ product_id: watch.id, url: publicUrl, position: i })
          if (imgErr) { console.error('product_images insert error:', imgErr.message); throw new Error(`Image save failed: ${imgErr.message}`) }
        }

        setForm(EMPTY_FORM)
        setImages([])
        setPreviews([])
        setMsg('Item posted — now live in the dealer catalog.')
        setTab('listings')
        fetchMyWatches()
      }
    } catch (err) {
      console.error('Post error:', err)
      setError(err?.message || 'Something went wrong. Please try again.')
    }
    setPosting(false)
  }

  async function handleBagPost(e) {
    e.preventDefault()
    setBagError('')
    if (!bagName.trim()) { setBagError('Name is required.'); return }
    if (!bagCostPrice) { setBagError('Cost price is required.'); return }
    setBagPosting(true)
    try {
      const parsed = parseQuickPost(bagName)
      const brand = parsed.brand && parsed.brand !== EMPTY_FORM.brand ? parsed.brand : 'Other'
      const model = parsed.model || bagName.trim()
      const condition = parsed.condition || EMPTY_FORM.condition

      const costEur = bagCostCurrency === 'CNY'
        ? Number(bagCostPrice) * (cnyToEurRate || 0)
        : Number(bagCostPrice)
      const sellingEur = bagSellingPrice ? Number(bagSellingPrice) : costEur * 1.4
      const priceUsd = rate ? Math.round(sellingEur * rate) : null

      const payload = {
        category: 'Bags',
        brand,
        model,
        reference: null,
        condition,
        price_eur: Math.round(sellingEur),
        price_usd: priceUsd,
        cost_eur: Math.round(costEur),
        vendor: parsed.vendor || null,
        notes: parsed.notes || null,
        scope_of_delivery: null,
        metal_type: null,
        subcategory: null,
        item_size: null,
        posted_by: profile.id,
        status: 'available',
      }

      const table = bagIsPreorder ? 'preorders' : 'products'
      const imgTable = bagIsPreorder ? 'preorder_images' : 'product_images'
      const fkCol = bagIsPreorder ? 'preorder_id' : 'product_id'
      const insertPayload = bagIsPreorder ? payload : { ...payload, source: 'manual' }

      const { data: item, error: pErr } = await supabase.from(table).insert(insertPayload).select().single()
      if (pErr) throw pErr

      let imagesFailed = 0
      for (let i = 0; i < bagImages.length; i++) {
        const file = bagImages[i]
        const ext = file.name.split('.').pop()
        const path = `${item.id}/${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('watch-images').upload(path, file)
        if (upErr) { console.error('Bag image upload error:', upErr.message); imagesFailed++; continue }
        const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path)
        const { error: dbErr } = await supabase.from(imgTable).insert({ [fkCol]: item.id, url: publicUrl, position: i })
        if (dbErr) { console.error('Bag image DB error:', dbErr.message); imagesFailed++ }
      }

      setBagName('')
      setBagCostPrice('')
      setBagCostCurrency('EUR')
      setBagSellingPrice('')
      setBagImages([])
      setBagPreviews([])
      setBagIsPreorder(false)
      setBagMsg(imagesFailed > 0
        ? `Bag ${bagIsPreorder ? 'preorder' : 'listing'} posted, but ${imagesFailed} image(s) failed to save — open the listing and re-upload them.`
        : bagIsPreorder ? 'Bags preorder posted.' : 'Item posted — now live in the dealer catalog.')
      setTab('listings')
      setListingType(bagIsPreorder ? 'preorders-bags' : 'instock')
      fetchPreorders()
      fetchMyWatches()
    } catch (err) {
      console.error('Bag listing post error:', err)
      setBagError(err?.message || 'Something went wrong. Please try again.')
    }
    setBagPosting(false)
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

  async function markPreorderSold(id) {
    await supabase.from('preorders').update({ status: 'sold' }).eq('id', id)
    fetchPreorders()
  }

  async function markPreorderAvailable(id) {
    await supabase.from('preorders').update({ status: 'available' }).eq('id', id)
    fetchPreorders()
  }

  // Extend an active preorder by 7 more days, or bring an archived one back —
  // identical operation, since "reactivating" just means giving it a future expiry again.
  async function extendPreorder(id) {
    await supabase.from('preorders').update({ expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }).eq('id', id)
    fetchPreorders()
  }

  function daysUntilExpiry(expiresAt) {
    if (!expiresAt) return null
    return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)
  }

  function fmtDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(2)
    return `${dd}/${mm}/${yy}`
  }

  function getPreorderThumb(p) {
    const imgs = [...(p.preorder_images || [])].sort((a, b) => a.position - b.position)
    return imgs[0]?.url || null
  }

  async function deletePreorder(id) {
    if (!window.confirm('Delete this preorder?')) return
    await supabase.from('preorder_images').delete().eq('preorder_id', id)
    const { error } = await supabase.from('preorders').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); return }
    fetchPreorders()
  }

  async function deleteWatch(id) {
    if (!window.confirm('Delete this item?')) return
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); return }
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
  const filteredWatches = watches.filter(w => {
    if (search && !w.brand?.toLowerCase().includes(q) && !w.model?.toLowerCase().includes(q) && !w.reference?.toLowerCase().includes(q)) return false
    if (inStockBrand !== 'all' && w.brand !== inStockBrand) return false
    if (inStockCondition !== 'all' && w.condition !== inStockCondition) return false
    if (inStockStatus !== 'all' && w.status !== inStockStatus) return false
    return true
  }).sort((a, b) => {
    if (inStockSortBy === 'oldest') return new Date(a.created_at) - new Date(b.created_at)
    if (inStockSortBy === 'price_asc') return Number(a.price_eur || 0) - Number(b.price_eur || 0)
    if (inStockSortBy === 'price_desc') return Number(b.price_eur || 0) - Number(a.price_eur || 0)
    return new Date(b.created_at) - new Date(a.created_at)
  })
  // Bags always count as archived for this agent-side grouping (the Preorders Bags
  // tab below still shows all of them unaffected — this only changes which bucket
  // they fall into for the Archived tab). Watches archive normally after 7 days.
  const isArchived = p => p.category === 'Bags' || (daysUntilExpiry(p.expires_at) !== null && daysUntilExpiry(p.expires_at) <= 0)
  const activePreorders = preorders.filter(p => !isArchived(p))
  const archivedPreorders = preorders.filter(isArchived)
  const watchPreorders = activePreorders.filter(p => p.category !== 'Bags')
  const bagPreorders = preorders.filter(p => p.category === 'Bags')
  const basePreorders = listingType === 'preorders-bags' ? bagPreorders
    : listingType === 'preorders-watches' ? watchPreorders
    : listingType === 'preorders-archived' ? archivedPreorders
    : preorders
  const preorderBrandOptions = [...new Set(preorders.map(p => p.brand).filter(Boolean))].sort()
  const filteredPreorders = basePreorders.filter(p => {
    if (search && !p.brand?.toLowerCase().includes(q) && !p.model?.toLowerCase().includes(q)) return false
    if (dateFrom && new Date(p.created_at) < new Date(dateFrom)) return false
    if (dateTo && new Date(p.created_at) > new Date(dateTo + 'T23:59:59')) return false
    if (preorderStatusFilter === 'available' && p.status !== 'available') return false
    if (preorderStatusFilter === 'sold' && p.status !== 'sold') return false
    if (preorderStatusFilter === 'expiring') {
      const days = daysUntilExpiry(p.expires_at)
      if (days === null || days > 2 || days <= 0) return false
    }
    if (preorderBrandFilter !== 'all' && p.brand !== preorderBrandFilter) return false
    if (preorderPriceMin && Number(p.price_eur || 0) < Number(preorderPriceMin)) return false
    if (preorderPriceMax && Number(p.price_eur || 0) > Number(preorderPriceMax)) return false
    return true
  }).sort((a, b) => {
    if (preorderSort === 'price_asc') return Number(a.price_eur || 0) - Number(b.price_eur || 0)
    if (preorderSort === 'price_desc') return Number(b.price_eur || 0) - Number(a.price_eur || 0)
    if (preorderSort === 'expiring') return new Date(a.expires_at || 0) - new Date(b.expires_at || 0)
    return new Date(b.created_at || 0) - new Date(a.created_at || 0)
  })

  const pendingOffers = offers.filter(o => o.status === 'pending').length

  const navItem = (id, label, icon, count, accent) => {
    const isActive = tab === id
    return (
      <button onClick={() => setTab(id)} style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: '100%', padding: '7px 10px', borderRadius: 8,
        border: 'none', cursor: 'pointer', textAlign: 'left',
        background: isActive ? 'rgba(184,150,90,0.1)' : 'transparent',
        color: isActive ? '#b8965a' : 'var(--faint)',
        fontWeight: isActive ? 600 : 400, fontSize: 13,
        transition: 'background 0.12s, color 0.12s',
      }}>
        <span style={{ opacity: isActive ? 1 : 0.6, display: 'flex' }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {count > 0 && (
          <span style={{ background: accent ? '#f59e0b' : 'var(--border-light)', color: accent ? '#fff' : 'var(--faint)', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>
            {count}
          </span>
        )}
      </button>
    )
  }

  const subItem = (lType, label, count) => {
    const isActive = tab === 'listings' && listingType === lType
    return (
      <button onClick={() => { setTab('listings'); setListingType(lType) }} style={{
        display: 'flex', alignItems: 'center',
        width: '100%', padding: '5px 10px 5px 30px', borderRadius: 8,
        border: 'none', cursor: 'pointer', textAlign: 'left',
        background: isActive ? 'rgba(184,150,90,0.08)' : 'transparent',
        color: isActive ? '#b8965a' : 'var(--faint)',
        fontWeight: isActive ? 600 : 400, fontSize: 12,
        transition: 'background 0.12s, color 0.12s',
      }}>
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ fontSize: 11, color: isActive ? '#b8965a' : 'var(--faint)', opacity: 0.7 }}>{count}</span>
      </button>
    )
  }

  const IconHome = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  const IconBag = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
  const IconPlus = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  const IconTag = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
  const IconPerson = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
  const IconBox = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
  const IconChevron = ({ open }) => <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'}/></svg>

  const selStyle = { fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer' }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Topbar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <aside style={{
          width: 220, flexShrink: 0,
          borderRight: '1px solid var(--border-light)',
          background: 'var(--surface)',
          display: 'flex', flexDirection: 'column',
          padding: '16px 10px 12px',
          overflowY: 'auto',
        }}>
          {navItem('overview', 'Overview', <IconHome />, 0)}

          <div style={{ height: 1, background: 'var(--border-light)', margin: '10px 4px 8px' }} />

          {/* Listings section */}
          <button onClick={() => setListingsOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 10px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            <span style={{ flex: 1 }}>Listings</span>
            <IconChevron open={listingsOpen} />
          </button>
          {listingsOpen && (
            <>
              {navItem('listings', 'My Listings', <IconBag />, 0)}
              <div style={{ marginBottom: 2 }}>
                {subItem('instock', 'In stock', watches.length)}
                {subItem('preorders-watches', 'Preorders Watches', watchPreorders.length)}
                {subItem('preorders-bags', 'Preorders Bags', bagPreorders.length)}
                {subItem('preorders-archived', 'Archived', archivedPreorders.length)}
              </div>
              {navItem('post', 'Post a Watch', <IconPlus />, 0)}
              {navItem('bagpreorder', 'Post a Bag', <IconPlus />, 0)}
            </>
          )}

          <div style={{ height: 1, background: 'var(--border-light)', margin: '10px 4px 8px' }} />

          {/* Activity section */}
          <button onClick={() => setActivityOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 10px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            <span style={{ flex: 1 }}>Activity</span>
            <IconChevron open={activityOpen} />
          </button>
          {activityOpen && (
            <>
              {navItem('offers', 'Offers', <IconTag />, pendingOffers, false)}
              {navItem('clients', 'Clients', <IconPerson />, 0)}
              {navItem('supplier', 'Supplier Queue', <IconBox />, supplierListings.length, supplierListings.length > 0)}
            </>
          )}

          <div style={{ flex: 1 }} />

          {/* Need help? */}
          <div style={{ margin: '12px 4px 0', background: 'var(--surface2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '14px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(184,150,90,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="13" height="13" fill="none" stroke="#b8965a" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Need help?</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 10, lineHeight: 1.5 }}>Our team is here to help you.</div>
            <button className="btn btn-full" style={{ fontSize: 11, padding: '6px 0' }}>Contact Support</button>
          </div>
        </aside>

        <div style={{ flex: 1, overflowY: 'auto' }}>

      {tab === 'overview' && (
        <div style={{ padding: '28px 28px 40px' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>Overview</h2>
          <p style={{ fontSize: 13, color: 'var(--faint)', margin: '0 0 24px' }}>Quick snapshot of your activity</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 28 }}>
            {[
              { label: 'In Stock', value: watches.length, color: '#22c55e', tab: 'listings' },
              { label: 'Preorders', value: watchPreorders.length + bagPreorders.length, color: '#b8965a', tab: 'listings' },
              { label: 'Pending Offers', value: pendingOffers, color: '#f59e0b', tab: 'offers' },
              { label: 'Supplier Queue', value: supplierListings.length, color: '#6366f1', tab: 'supplier' },
            ].map(s => (
              <button key={s.label} onClick={() => setTab(s.tab)} style={{ textAlign: 'left', border: '1px solid var(--border-light)', borderRadius: 12, padding: '16px', background: 'var(--surface)', cursor: 'pointer', transition: 'border-color 0.12s' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--faint)' }}>{s.label}</div>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={() => setTab('post')} style={{ fontSize: 13 }}>Post a Watch</button>
            <button className="btn" onClick={() => { setTab('listings'); setListingType('instock') }} style={{ fontSize: 13 }}>View All Listings</button>
          </div>
        </div>
      )}

      {tab === 'listings' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Page header */}
          <div style={{ padding: '24px 28px 0', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>My Listings</h2>
                <p style={{ fontSize: 13, color: 'var(--faint)', margin: '3px 0 0' }}>Manage your watch and bag inventory</p>
              </div>
              <button className="btn" onClick={() => setTab('post')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px', whiteSpace: 'nowrap' }}>
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Listing
              </button>
            </div>

            {/* Underline tabs */}
            <div style={{ display: 'flex', gap: 0 }}>
              {[
                { id: 'instock', label: 'In stock', count: watches.length },
                { id: 'preorders-watches', label: 'Preorders Watches', count: watchPreorders.length },
                { id: 'preorders-bags', label: 'Preorders Bags', count: bagPreorders.length },
                { id: 'preorders-archived', label: 'Archived', count: archivedPreorders.length },
              ].map(({ id, label, count }) => (
                <button key={id} onClick={() => setListingType(id)} style={{
                  padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: listingType === id ? 600 : 400,
                  color: listingType === id ? 'var(--text)' : 'var(--faint)',
                  borderBottom: listingType === id ? '2px solid #b8965a' : '2px solid transparent',
                  marginBottom: -1, transition: 'color 0.12s, border-color 0.12s',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  {label}
                  {count > 0 && <span style={{ fontSize: 11, background: listingType === id ? 'rgba(184,150,90,0.12)' : 'var(--surface2)', color: listingType === id ? '#b8965a' : 'var(--faint)', borderRadius: 8, padding: '0 5px', fontWeight: 600 }}>{count}</span>}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: '16px 28px', flex: 1, overflowY: 'auto' }}>
          {msg && <div className="success-msg" style={{ marginBottom: 12 }}>{msg}</div>}

          {/* Search + filters row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              placeholder="Search brand, model or reference..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180, boxSizing: 'border-box' }}
            />
            {listingType === 'instock' && (
              <>
                <select value={inStockBrand} onChange={e => setInStockBrand(e.target.value)} style={selStyle}>
                  <option value="all">All brands</option>
                  {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <select value={inStockCondition} onChange={e => setInStockCondition(e.target.value)} style={selStyle}>
                  <option value="all">All conditions</option>
                  {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={inStockStatus} onChange={e => setInStockStatus(e.target.value)} style={selStyle}>
                  <option value="all">All statuses</option>
                  <option value="available">Available</option>
                  <option value="sold">Sold</option>
                </select>
                <select value={inStockSortBy} onChange={e => setInStockSortBy(e.target.value)} style={selStyle}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                </select>
                {/* Grid / List toggle */}
                <div style={{ display: 'flex', border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }}>
                  <button onClick={() => setViewMode('list')} title="List view" style={{ padding: '7px 10px', border: 'none', cursor: 'pointer', background: viewMode === 'list' ? 'var(--surface2)' : 'transparent', color: viewMode === 'list' ? 'var(--text)' : 'var(--faint)', display: 'flex', alignItems: 'center' }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  </button>
                  <button onClick={() => setViewMode('grid')} title="Grid view" style={{ padding: '7px 10px', border: 'none', cursor: 'pointer', background: viewMode === 'grid' ? 'var(--surface2)' : 'transparent', color: viewMode === 'grid' ? 'var(--text)' : 'var(--faint)', display: 'flex', alignItems: 'center' }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                  </button>
                </div>
              </>
            )}
          </div>

          {(listingType === 'preorders-watches' || listingType === 'preorders-bags' || listingType === 'preorders-archived') && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Listed from</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: '100%', fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', boxSizing: 'border-box' }} />
                </div>
                <span style={{ color: 'var(--faint)', fontSize: 13, paddingBottom: 8 }}>—</span>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Listed to</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: '100%', fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', boxSizing: 'border-box' }} />
                </div>
                {(dateFrom || dateTo) && (
                  <button className="btn btn-sm" onClick={() => { setDateFrom(''); setDateTo('') }} style={{ whiteSpace: 'nowrap' }}>Clear</button>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <select value={preorderStatusFilter} onChange={e => setPreorderStatusFilter(e.target.value)} style={selStyle}>
                  <option value="all">All statuses</option>
                  <option value="available">Available</option>
                  <option value="sold">Sold</option>
                  <option value="expiring">Expiring soon</option>
                </select>
                <select value={preorderBrandFilter} onChange={e => setPreorderBrandFilter(e.target.value)} style={selStyle}>
                  <option value="all">All brands</option>
                  {preorderBrandOptions.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <input
                  type="number" placeholder="Min €" value={preorderPriceMin} onChange={e => setPreorderPriceMin(e.target.value)}
                  style={{ width: 90, fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)' }}
                />
                <input
                  type="number" placeholder="Max €" value={preorderPriceMax} onChange={e => setPreorderPriceMax(e.target.value)}
                  style={{ width: 90, fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)' }}
                />
                <select value={preorderSort} onChange={e => setPreorderSort(e.target.value)} style={selStyle}>
                  <option value="newest">Newest</option>
                  <option value="price_asc">Price ↑</option>
                  <option value="price_desc">Price ↓</option>
                  <option value="expiring">Expiring soon</option>
                </select>
              </div>
            </>
          )}

          {listingType === 'instock' && (
            loading
              ? <div className="loading-page" style={{ minHeight: 200 }}><div className="spinner" /></div>
              : filteredWatches.length === 0
                ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--faint)' }}>
                    <svg width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.2" viewBox="0 0 24 24" style={{ marginBottom: 16, opacity: 0.35 }}>
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                      <line x1="12" y1="22.08" x2="12" y2="12"/>
                    </svg>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>{search ? 'No results found' : 'No listings yet'}</div>
                    <div style={{ fontSize: 13, marginBottom: 20 }}>{search ? 'Try a different search or filter' : 'Post your first watch or bag to get started'}</div>
                    {!search && <button className="btn" onClick={() => setTab('post')} style={{ fontSize: 13 }}>Post a Watch</button>}
                  </div>
                )
                : filteredWatches.map(w => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border-light)', borderRadius: 10, marginBottom: 8, background: 'var(--surface)' }}>
                  <a href={`/catalog/${toSlug(w)}`} onClick={e => { e.preventDefault(); navigate(`/catalog/${toSlug(w)}`) }} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                    <div style={{ width: 50, height: 50, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {getThumb(w) ? <img src={getThumb(w)} alt={w.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 20 }}>⌚</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{w.brand} {w.model}</div>
                      <div style={{ fontSize: 11, color: '#aaa' }}>{fmtPrice(w)} · {w.condition}{w.reference ? ` · ${w.reference}` : ''}{w.category ? ` · ${w.category}` : ''}</div>
                    </div>
                  </a>
                  <span className={`badge badge-${w.status}`}>{w.status}</span>
                  <button className="btn btn-sm" onClick={() => navigate(`/catalog/${toSlug(w)}`)}>Edit</button>
                  {w.status !== 'sold' && (
                    <button className="btn btn-sm" onClick={() => markSold(w.id)}>Mark sold</button>
                  )}
                  {(profile?.role === 'admin' || w.posted_by === profile?.id) && (
                    <button className="btn btn-sm btn-danger" onClick={() => deleteWatch(w.id)}>Delete</button>
                  )}
                </div>
              ))
          )}

          {(listingType === 'preorders-watches' || listingType === 'preorders-bags' || listingType === 'preorders-archived') && (
            filteredPreorders.length === 0
              ? <div className="empty-state">{search ? 'No preorders match your search' : listingType === 'preorders-archived' ? 'No archived preorders' : 'No preorders yet'}</div>
              : filteredPreorders.map(p => {
              const days = daysUntilExpiry(p.expires_at)
              const archived = listingType === 'preorders-archived'
              return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border-light)', borderRadius: 10, marginBottom: 8, background: 'var(--surface)' }}>
                <a href={`/catalog/${toSlug(p)}`} onClick={e => { e.preventDefault(); navigate(`/catalog/${toSlug(p)}`) }} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {getPreorderThumb(p) ? <img src={getPreorderThumb(p)} alt={p.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 20 }}>🔖</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.brand} {p.model}</div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>{p.price_eur ? `€${Number(p.price_eur).toLocaleString()}` : '—'} · {p.condition}{p.category ? ` · ${p.category}` : ''}</div>
                  </div>
                </a>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span className={`badge badge-${p.status}`}>{p.status}</span>
                  {!archived && days !== null && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                      color: days <= 2 ? '#fff' : '#888',
                      background: days <= 2 ? '#d9534f' : 'var(--surface2)',
                    }}>
                      Expires in {days}d
                    </span>
                  )}
                  {archived && (
                    <span style={{ fontSize: 10, color: '#bbb' }}>Expired {fmtDate(p.expires_at)}</span>
                  )}
                  {p.status === 'posted' && p.posted_at && (
                    <span style={{ fontSize: 10, color: '#bbb' }}>Posted {fmtDate(p.posted_at)}</span>
                  )}
                </div>
                {p.status === 'sold'
                  ? <button className="btn btn-sm" onClick={e => { e.stopPropagation(); markPreorderAvailable(p.id) }}>Mark available</button>
                  : <button className="btn btn-sm" onClick={e => { e.stopPropagation(); markPreorderSold(p.id) }}>Mark sold</button>
                }
                <button className="btn btn-sm" onClick={e => { e.stopPropagation(); extendPreorder(p.id) }}>
                  {archived ? 'Reactivate' : 'Extend 7 days'}
                </button>
                {(profile?.role === 'admin' || p.posted_by === profile?.id) && (
                  <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); deletePreorder(p.id) }}>Delete</button>
                )}
              </div>
              )
            })
          )}
          </div>
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
                  <div key={offer.id} style={{ border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginBottom: 12, background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div
                        onClick={() => navigate(`/catalog/${toSlug(watch)}`)}
                        style={{ width: 52, height: 52, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
                      >
                        {thumb ? <img src={thumb} alt={watch.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 20 }}>⌚</span>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} onClick={() => navigate(`/catalog/${toSlug(watch)}`)}>
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
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--muted)' }}>{watch?.price_eur ? `€${Number(watch.price_eur).toLocaleString()}` : '—'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Offer</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>€{Number(offer.offer_price).toLocaleString()}</div>
                          </div>
                          {offer.counter_price && (
                            <div>
                              <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your counter</div>
                              <div style={{ fontSize: 15, fontWeight: 600, color: '#b8965a' }}>€{Number(offer.counter_price).toLocaleString()}</div>
                            </div>
                          )}
                        </div>

                        {offer.dealer_comment && (
                          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface2)', borderRadius: 6, padding: '6px 10px' }}>
                            <span style={{ color: 'var(--faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Dealer · </span>
                            {offer.dealer_comment}
                          </div>
                        )}
                        {offer.agent_comment && (
                          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', background: 'rgba(184,150,106,0.08)', borderRadius: 6, padding: '6px 10px' }}>
                            <span style={{ color: 'var(--faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Your note · </span>
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
        <div style={{ padding: '16px 16px 40px', maxWidth: 600 }}>
          {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

          <form onSubmit={handlePost}>

            {/* Photos */}
            <label htmlFor="img-upload" style={{ display: 'block', marginBottom: 20, borderRadius: 14, border: '1.5px dashed var(--border)', background: 'var(--surface)', cursor: 'pointer', overflow: 'hidden', minHeight: 90, transition: 'border-color 0.15s' }}>
              {previews.length > 0
                ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 12 }}>
                    {previews.map((p, i) => <img key={i} src={p} alt="" style={{ width: 68, height: 68, borderRadius: 10, objectFit: 'cover', border: '1px solid #e8e5e0' }} />)}
                    <div style={{ width: 68, height: 68, borderRadius: 10, border: '1.5px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 22 }}>+</div>
                  </div>
                : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 90, gap: 6 }}>
                    <div style={{ fontSize: 24, lineHeight: 1 }}>&#128247;</div>
                    <div style={{ fontSize: 13, color: '#888', fontWeight: 500 }}>Tap to upload photos</div>
                    <div style={{ fontSize: 11, color: '#bbb' }}>JPG, PNG — multiple allowed</div>
                  </div>
              }
              <input id="img-upload" type="file" accept="image/*" multiple onChange={handleImages} style={{ display: 'none' }} />
            </label>

            {/* Quick Post */}
            <div style={{ marginBottom: 20, background: 'var(--surface)', borderRadius: 14, padding: '14px 16px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, letterSpacing: '-0.1px' }}>Quick Post</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>Paste all info — brand, model, price, vendor — and the fields fill automatically.</div>
              <textarea
                rows={4}
                placeholder={'Panerai PAM00359\nCard & Box 2014\n3300\n2380\nDingsp'}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, borderRadius: 8, resize: 'vertical', lineHeight: 1.6 }}
                onChange={async e => {
                  const parsed = parseQuickPost(e.target.value)
                  if (parsed.reference && (!parsed.model || parsed.model === parsed.reference)) {
                    const { data } = await supabase.from('products').select('model').ilike('reference', `%${parsed.reference}%`).limit(1).single()
                    if (data?.model) parsed.model = data.model
                  }
                  setForm(f => {
                    const updated = { ...f }
                    if (parsed.brand !== EMPTY_FORM.brand || !f.brand) updated.brand = parsed.brand
                    if (parsed.model) updated.model = parsed.model
                    if (parsed.price_eur) updated.price_eur = parsed.price_eur
                    if (parsed.condition && parsed.condition !== EMPTY_FORM.condition) updated.condition = parsed.condition
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

            {/* Item details */}
            <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '16px 16px 4px', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 14 }}>Item details</div>

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
            </div>

            {/* Pricing & info */}
            <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '16px 16px 4px', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 14 }}>Pricing & info</div>

              <div className="form-2col">
                <div className="form-row">
                  <label>Selling Price (€)</label>
                  <input type="number" value={form.price_eur} onChange={e => handleField('price_eur', e.target.value)} placeholder="e.g. 35000" required />
                  {usdPreview && <div style={{ fontSize: 12, color: '#b0a898', marginTop: 4 }}>≈ {usdPreview} USD</div>}
                </div>
                <div className="form-row">
                  <label>Cost Price (€)</label>
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
            </div>

            {/* Preorder toggle */}
            <div
              onClick={() => handleField('is_preorder', !form.is_preorder)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: form.is_preorder ? 'var(--gold-light)' : 'var(--surface)', borderRadius: 14, border: `1px solid ${form.is_preorder ? 'rgba(184,150,106,0.4)' : 'var(--border)'}`, marginBottom: 20, cursor: 'pointer', transition: 'all 0.2s' }}
            >
              <div style={{ width: 44, height: 26, borderRadius: 13, background: form.is_preorder ? '#b8965a' : '#ddd', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 3, left: form.is_preorder ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.18s', boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: form.is_preorder ? 'var(--gold)' : 'var(--text)' }}>Preorder</div>
                <div style={{ fontSize: 11, color: '#b0a898', marginTop: 1 }}>{form.is_preorder ? 'No SKU required — item not yet in stock' : 'Toggle on if item is not yet in stock'}</div>
              </div>
            </div>

            <button type="submit" className="btn btn-dark btn-full" disabled={posting} style={{ height: 48, fontSize: 15, borderRadius: 12 }}>
              {posting ? <span className="spinner" style={{ width: 18, height: 18 }} /> : form.is_preorder ? 'Post preorder' : 'Post to catalog'}
            </button>
          </form>
        </div>
      )}

      {tab === 'bagpreorder' && (
        <div style={{ padding: '16px 16px 40px', maxWidth: 600 }}>
          {bagMsg && <div className="success-msg" style={{ marginBottom: 16 }}>{bagMsg}</div>}
          {bagError && <div className="error-msg" style={{ marginBottom: 16 }}>{bagError}</div>}

          <form onSubmit={handleBagPost}>
            {/* Photos */}
            <label htmlFor="bag-img-upload" style={{ display: 'block', marginBottom: 20, borderRadius: 14, border: '1.5px dashed var(--border)', background: 'var(--surface)', cursor: 'pointer', overflow: 'hidden', minHeight: 90, transition: 'border-color 0.15s' }}>
              {bagPreviews.length > 0
                ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 12 }}>
                    {bagPreviews.map((p, i) => (
                      <div
                        key={i}
                        draggable
                        onDragStart={e => { e.stopPropagation(); setBagDragIndex(i) }}
                        onDragOver={e => { e.preventDefault() }}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); reorderBagImages(bagDragIndex, i); setBagDragIndex(null) }}
                        onDragEnd={() => setBagDragIndex(null)}
                        onClick={e => e.preventDefault()}
                        style={{ position: 'relative', opacity: bagDragIndex === i ? 0.4 : 1, cursor: 'grab' }}
                      >
                        <img src={p} alt="" style={{ width: 68, height: 68, borderRadius: 10, objectFit: 'cover', border: '1px solid #e8e5e0' }} />
                        <button
                          type="button"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); removeBagImage(i) }}
                          style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: '#e00', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >×</button>
                      </div>
                    ))}
                    <div style={{ width: 68, height: 68, borderRadius: 10, border: '1.5px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 22 }}>+</div>
                  </div>
                : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 90, gap: 6 }}>
                    <div style={{ fontSize: 24, lineHeight: 1 }}>&#128247;</div>
                    <div style={{ fontSize: 13, color: '#888', fontWeight: 500 }}>Tap to upload photos</div>
                    <div style={{ fontSize: 11, color: '#bbb' }}>JPG, PNG — multiple allowed, drag to reorder</div>
                  </div>
              }
              <input id="bag-img-upload" type="file" accept="image/*" multiple onChange={handleBagImages} style={{ display: 'none' }} />
            </label>

            <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '16px 16px 4px', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 14 }}>Bags preorder — quick entry</div>
              <div className="form-row">
                <label>Name</label>
                <textarea
                  value={bagName}
                  onChange={e => setBagName(e.target.value)}
                  rows={3}
                  placeholder={'e.g. Hermès Birkin 30 Togo Gold HW\nor paste full details — brand & condition are detected automatically'}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, borderRadius: 8, resize: 'vertical', lineHeight: 1.6 }}
                  required
                />
              </div>
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '16px 16px 4px', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 14 }}>Pricing</div>
              <div className="form-row">
                <label>Cost price</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="number" value={bagCostPrice} onChange={e => setBagCostPrice(e.target.value)} placeholder="e.g. 28000" style={{ flex: 1 }} required />
                  <select value={bagCostCurrency} onChange={e => setBagCostCurrency(e.target.value)} style={{ width: 90 }}>
                    <option value="EUR">EUR</option>
                    <option value="CNY">CNY</option>
                  </select>
                </div>
                {bagCostCurrency === 'CNY' && bagCostPrice && (
                  <div style={{ fontSize: 12, color: '#b0a898', marginTop: 4 }}>
                    {cnyToEurRate ? `≈ €${Math.round(Number(bagCostPrice) * cnyToEurRate).toLocaleString()}` : 'Loading CNY → EUR rate…'}
                  </div>
                )}
              </div>

              <div className="form-row">
                <label>Selling price (€) — optional</label>
                <input type="number" value={bagSellingPrice} onChange={e => setBagSellingPrice(e.target.value)} placeholder="leave blank to auto-calc as cost + 40%" />
                {bagCostPrice && (() => {
                  const costEur = bagCostCurrency === 'CNY' ? Number(bagCostPrice) * (cnyToEurRate || 0) : Number(bagCostPrice)
                  const sellingEur = bagSellingPrice ? Number(bagSellingPrice) : costEur * 1.4
                  const usd = rate ? Math.round(sellingEur * rate) : null
                  return (
                    <div style={{ fontSize: 12, color: '#b0a898', marginTop: 4 }}>
                      Selling price: €{Math.round(sellingEur).toLocaleString()}{usd ? ` ≈ $${usd.toLocaleString()}` : ''}{!bagSellingPrice ? ' (auto: cost + 40%)' : ''}
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Preorder toggle */}
            <div
              onClick={() => setBagIsPreorder(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: bagIsPreorder ? 'var(--gold-light)' : 'var(--surface)', borderRadius: 14, border: `1px solid ${bagIsPreorder ? 'rgba(184,150,106,0.4)' : 'var(--border)'}`, marginBottom: 20, cursor: 'pointer', transition: 'all 0.2s' }}
            >
              <div style={{ width: 44, height: 26, borderRadius: 13, background: bagIsPreorder ? '#b8965a' : '#ddd', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 3, left: bagIsPreorder ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.18s', boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: bagIsPreorder ? 'var(--gold)' : 'var(--text)' }}>Preorder</div>
                <div style={{ fontSize: 11, color: '#b0a898', marginTop: 1 }}>{bagIsPreorder ? 'No SKU required — item not yet in stock' : 'Toggle on if item is not yet in stock'}</div>
              </div>
            </div>

            <button type="submit" className="btn btn-dark btn-full" disabled={bagPosting} style={{ height: 48, fontSize: 15, borderRadius: 12 }}>
              {bagPosting ? <span className="spinner" style={{ width: 18, height: 18 }} /> : bagIsPreorder ? 'Post bags preorder' : 'Post to catalog'}
            </button>
          </form>
        </div>
      )}
      {tab === 'clients' && (
        <div style={{ padding: 16, maxWidth: 540 }}>
          {/* Generate link */}
          <div className="card" style={{ padding: '20px', marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Generate invite link</div>
            {linkError && <div className="error-msg" style={{ marginBottom: 10 }}>{linkError}</div>}
            {generatedLink && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{generatedLink}</div>
                <button onClick={() => handleCopy(generatedLink, 'new')} className="btn btn-sm" style={{ flexShrink: 0, fontSize: 12 }}>
                  {copied === 'new' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            )}
            <button className="btn btn-dark" onClick={handleGenerateLink} disabled={generating}>
              {generating ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '+ Generate new link'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>Each link can only be used once. Share it directly with the dealer.</div>
          </div>

          {/* Pending links */}
          {!clientsLoading && pendingTokens.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Pending links ({pendingTokens.length})</div>
              {pendingTokens.map(t => {
                const link = `${window.location.origin}/join/${t.token}`
                return (
                  <div key={t.id} className="card" style={{ padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</div>
                    <button onClick={() => handleCopy(link, t.id)} className="btn btn-sm" style={{ fontSize: 11, flexShrink: 0 }}>
                      {copied === t.id ? '✓' : 'Copy'}
                    </button>
                    <button onClick={() => handleRevokeToken(t.id)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0, padding: '0 2px' }} title="Revoke">×</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Joined dealers */}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            {clientsLoading ? 'Loading…' : `Joined dealers (${clients.length})`}
          </div>
          {!clientsLoading && clients.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 24 }}>No dealers have joined yet.</div>
          )}
          {clients.map(c => (
            <div key={c.id} className="card" style={{ padding: '14px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#b8965a22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: '#b8965a', flexShrink: 0 }}>
                {(c.full_name || c.email || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.full_name || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.email}</div>
                {c.phone && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.phone}</div>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'supplier' && (
        <div style={{ padding: '0 16px 40px' }}>
          {supplierListings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--faint)', fontSize: 14 }}>No pending supplier submissions.</div>
          ) : supplierListings.map(listing => {
            const imgs = (listing.supplier_listing_images || []).sort((a, b) => a.position - b.position)
            const rd = supReviewData[listing.id] || {}
            const setRd = patch => setSupReviewData(prev => ({ ...prev, [listing.id]: { ...prev[listing.id], ...patch } }))
            return (
              <div key={listing.id} style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: 16, marginBottom: 16 }}>
                {imgs.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {imgs.slice(0, 5).map((img, i) => (
                      <img key={i} src={img.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-light)' }} />
                    ))}
                    {imgs.length > 5 && <div style={{ width: 64, height: 64, borderRadius: 8, background: 'var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--faint)' }}>+{imgs.length - 5}</div>}
                  </div>
                )}

                {supEditId === listing.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input className="input" placeholder="Brand" value={supEditForm.brand} onChange={e => setSupEditForm(f => ({ ...f, brand: e.target.value }))} style={{ marginBottom: 0 }} />
                      <input className="input" placeholder="Model" value={supEditForm.model} onChange={e => setSupEditForm(f => ({ ...f, model: e.target.value }))} style={{ marginBottom: 0 }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input className="input" placeholder="Reference" value={supEditForm.reference} onChange={e => setSupEditForm(f => ({ ...f, reference: e.target.value }))} style={{ marginBottom: 0 }} />
                      <input className="input" placeholder="Asking price (€)" type="number" value={supEditForm.asking_price} onChange={e => setSupEditForm(f => ({ ...f, asking_price: e.target.value }))} style={{ marginBottom: 0 }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <select className="input" value={supEditForm.condition} onChange={e => setSupEditForm(f => ({ ...f, condition: e.target.value }))} style={{ marginBottom: 0 }}>
                        <option value="">Condition</option>
                        {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <select className="input" value={supEditForm.scope_of_delivery} onChange={e => setSupEditForm(f => ({ ...f, scope_of_delivery: e.target.value }))} style={{ marginBottom: 0 }}>
                        <option value="">Scope</option>
                        <option>Watch Only</option>
                        <option>With Card</option>
                        <option>With Box</option>
                        <option>Card &amp; Box</option>
                      </select>
                    </div>
                    <textarea className="input" placeholder="Notes" rows={2} value={supEditForm.notes} onChange={e => setSupEditForm(f => ({ ...f, notes: e.target.value }))} style={{ marginBottom: 0, resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-dark btn-sm" onClick={() => saveSupplierListingEdit(listing.id)}>Save changes</button>
                      <button className="btn btn-sm" onClick={() => setSupEditId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{listing.brand} {listing.model}</div>
                      <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => enterSupEdit(listing)}>Edit</button>
                    </div>
                    {listing.reference && <div style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 2 }}>Ref. {listing.reference}</div>}
                    <div style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 2 }}>{listing.condition}</div>
                    {listing.scope_of_delivery && <div style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 2 }}>{listing.scope_of_delivery}</div>}
                    {listing.asking_price && <div style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 2 }}>Asking: €{listing.asking_price.toLocaleString()}</div>}
                    {listing.notes && <div style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 2 }}>{listing.notes}</div>}
                    <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>
                      From: {listing.profiles?.full_name || '—'}{listing.profiles?.phone ? ` · ${listing.profiles.phone}` : ''}
                      {' · '}{new Date(listing.created_at).toLocaleDateString()}
                    </div>
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      type="number"
                      placeholder="Selling price (€)"
                      value={rd.price || ''}
                      onChange={e => setRd({ price: e.target.value })}
                      style={{ width: 160, marginBottom: 0 }}
                    />
                    <button className="btn btn-dark btn-sm" onClick={() => approveSupplierListing(listing)}>Approve & Publish</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      placeholder="Rejection reason"
                      value={rd.reason || ''}
                      onChange={e => setRd({ reason: e.target.value })}
                      style={{ flex: 1, minWidth: 160, marginBottom: 0 }}
                    />
                    <button className="btn btn-danger btn-sm" onClick={() => rejectSupplierListing(listing)}>Reject</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

        <Footer />
        </div> {/* end main scroll area */}
      </div> {/* end flex row */}
    </div>
  )
}
