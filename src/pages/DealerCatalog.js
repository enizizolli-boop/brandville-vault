import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCurrency } from '../context/CurrencyContext'
import { useExchangeRate } from '../hooks/useExchangeRate'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'
import Footer from '../components/Footer'

const WATCH_BRANDS = [
  'A. Lange & Söhne','Audemars Piguet','Blancpain','Breguet','Breitling','Cartier',
  'Chopard','Girard-Perregaux','Grand Seiko','Harry Winston','Hublot','IWC',
  'Jaeger-LeCoultre','Omega','Other','Panerai','Patek Philippe','Piaget',
  'Richard Mille','Rolex','TAG Heuer','Tudor','Ulysse Nardin','Vacheron Constantin','Zenith'
]
const JEWELLERY_BRANDS = [
  'Bulgari','Cartier','Chanel','Chopard','De Beers','Dior','Graff','Harry Winston',
  'Hermès','Mikimoto','Other','Piaget','Tiffany & Co','Van Cleef & Arpels'
]
const BAG_BRANDS = [
  'Balenciaga','Bottega Veneta','Celine','Chanel','Dior','Fendi','Gucci',
  'Hermès','Loewe','Louis Vuitton','Other','Prada','Saint Laurent'
]
const SHOES_BRANDS = [
  'Chanel','Christian Louboutin','Dior','Gucci','Hermès','Louis Vuitton',
  'Manolo Blahnik','Other','Prada','Saint Laurent','Valentino'
]
const ACCESSORIES_BRANDS = [
  'Bottega Veneta','Burberry','Cartier','Celine','Chanel','Dior','Fendi',
  'Gucci','Hermès','Louis Vuitton','Other','Prada','Saint Laurent'
]
const ALL_BRANDS = [...new Set([...WATCH_BRANDS,...JEWELLERY_BRANDS,...BAG_BRANDS,...SHOES_BRANDS,...ACCESSORIES_BRANDS])].sort()

const BAGS_CATEGORIES = ['Bags', 'Accessories', 'Shoes']
const WA_NUMBERS = { Watches: '18488639660', Bags: '18254757069', Jewellery: '17325061373' }
const WA_SVG = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
)

const TRUST_BADGES = [
  {
    icon: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    label: 'Verified Inventory', sub: '100% Authentic'
  },
  {
    icon: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
    label: 'Global Network', sub: 'Trusted Dealers'
  },
  {
    icon: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    label: 'Secure Transactions', sub: 'Protected Deals'
  },
  {
    icon: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
    label: 'Fast Worldwide Shipping', sub: 'Insured Delivery'
  },
]

const WHY_ITEMS = [
  { icon: '✓', title: 'Curated Inventory', sub: 'Only verified, authentic pieces from trusted sources.' },
  { icon: '✓', title: 'Competitive Pricing', sub: 'Market-aligned pricing with strong margins.' },
  { icon: '✓', title: 'Trusted Network', sub: 'Connect with 500+ verified dealers worldwide.' },
  { icon: '✓', title: 'Dedicated Support', sub: 'Your personal account manager for your business.' },
]

function cleanRef(ref) {
  if (!ref) return ''
  if (ref.includes('/')) return ref.split('/').filter(Boolean).pop()
  const n = ref.match(/(\d+)$/)
  if (n) return n[1]
  return ref
}

function fmtPrice(watch, currency, rate) {
  if (currency === 'USD') {
    if (watch.price_eur && rate) return '$' + Math.round(Number(watch.price_eur) * rate).toLocaleString()
    if (watch.price_usd) return '$' + Number(watch.price_usd).toLocaleString()
    return '—'
  }
  if (watch.price_eur) return '€' + Number(watch.price_eur).toLocaleString()
  return '—'
}

function inferJewelleryType(item) {
  const explicit = item?.subcategory
  if (explicit) return explicit
  const text = `${item?.model || ''} ${item?.reference || ''} ${item?.notes || ''}`.toLowerCase()
  if (/\b(?:earrings?|earings?|ear-?rings?)\b/.test(text) || /\b(?:studs?|hoops?)\b/.test(text)) return 'Earrings'
  if (/\bbracelets?\b/.test(text) && !/watch\s+bracelet|bracelet\s*\(|strap|rubber|leather|metal\s+bracelet/i.test(text)) return 'Bracelets'
  if (/\bnecklaces?\b/.test(text)) return 'Necklaces'
  if (/\brings?\b/.test(text)) return 'Rings'
  return ''
}

function shortenCond(cond) {
  if (!cond) return null
  if (cond.toLowerCase().includes('minor')) return 'Minor wear'
  if (cond.toLowerCase().includes('major')) return 'Major wear'
  return cond.split(' ').slice(0, 2).join(' ')
}

const PLACEHOLDERS = {
  Watches: (
    <svg width="72" height="72" viewBox="0 0 80 80" fill="none">
      <rect x="30" y="6" width="20" height="13" rx="3" stroke="#C9A87A" strokeWidth="1.5"/>
      <rect x="30" y="61" width="20" height="13" rx="3" stroke="#C9A87A" strokeWidth="1.5"/>
      <circle cx="40" cy="40" r="21" stroke="#C9A87A" strokeWidth="1.5"/>
      <circle cx="40" cy="40" r="2" fill="#C9A87A"/>
      <line x1="40" y1="38" x2="40" y2="25" stroke="#C9A87A" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="40" y1="40" x2="53" y2="46" stroke="#C9A87A" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  Jewellery: (
    <svg width="72" height="72" viewBox="0 0 80 80" fill="none">
      <polygon points="40,12 58,28 51,62 29,62 22,28" stroke="#C9A87A" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
      <line x1="22" y1="28" x2="40" y2="38" stroke="#C9A87A" strokeWidth="1.2"/>
      <line x1="58" y1="28" x2="40" y2="38" stroke="#C9A87A" strokeWidth="1.2"/>
    </svg>
  ),
  Bags: (
    <svg width="72" height="72" viewBox="0 0 80 80" fill="none">
      <path d="M29 32 Q29 20 40 20 Q51 20 51 32" stroke="#C9A87A" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <rect x="16" y="32" width="48" height="30" rx="6" stroke="#C9A87A" strokeWidth="1.5" fill="none"/>
    </svg>
  ),
}

function CategoryPlaceholder({ category }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f2ed' }}>
      {PLACEHOLDERS[category] || PLACEHOLDERS.Watches}
    </div>
  )
}

function CardImages({ watch }) {
  const [idx, setIdx] = useState(0)
  const imgs = [...(watch.product_images || [])].sort((a, b) => a.position - b.position)
  const touchX = useRef(null)

  if (!imgs.length) return <CategoryPlaceholder category={watch.category} />

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}
      onTouchStart={e => { touchX.current = e.touches[0].clientX }}
      onTouchEnd={e => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        if (dx < -40 && idx < imgs.length - 1) setIdx(i => i + 1)
        if (dx > 40 && idx > 0) setIdx(i => i - 1)
        touchX.current = null
      }}>
      <img src={imgs[idx].url} alt={watch.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {imgs.length > 1 && idx > 0 && (
        <button onClick={e => { e.stopPropagation(); setIdx(i => Math.max(i-1,0)) }}
          style={{ position:'absolute',left:4,top:'50%',transform:'translateY(-50%)',background:'rgba(0,0,0,0.35)',border:'none',color:'#fff',width:24,height:24,borderRadius:'50%',fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>‹</button>
      )}
      {imgs.length > 1 && idx < imgs.length - 1 && (
        <button onClick={e => { e.stopPropagation(); setIdx(i => Math.min(i+1,imgs.length-1)) }}
          style={{ position:'absolute',right:4,top:'50%',transform:'translateY(-50%)',background:'rgba(0,0,0,0.35)',border:'none',color:'#fff',width:24,height:24,borderRadius:'50%',fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>›</button>
      )}
      {imgs.length > 1 && (
        <div style={{ position:'absolute',bottom:6,left:0,right:0,display:'flex',justifyContent:'center',gap:4 }}>
          {imgs.map((_,i) => (
            <div key={i} onClick={e => { e.stopPropagation(); setIdx(i) }}
              style={{ width:5,height:5,borderRadius:'50%',background: i===idx?'#fff':'rgba(255,255,255,0.45)',cursor:'pointer' }} />
          ))}
        </div>
      )}
    </div>
  )
}

const PS_MIN = 1000
const PS_MAX = 150000

function PriceSlider({ minVal, maxVal, onMinChange, onMaxChange }) {
  const minPct = ((minVal - PS_MIN) / (PS_MAX - PS_MIN)) * 100
  const maxPct = ((maxVal - PS_MIN) / (PS_MAX - PS_MIN)) * 100

  function fmtLabel(v, isMax) {
    if (isMax && v >= PS_MAX) return `€ ${(PS_MAX / 1000).toFixed(0)},000+`
    return `€ ${v >= 1000 ? (v / 1000).toFixed(0) + ',000' : v}`
  }

  return (
    <div className="price-slider">
      <div className="ps-track-wrap">
        <div className="ps-track-bg" />
        <div className="ps-track-fill" style={{ left: minPct + '%', width: (maxPct - minPct) + '%' }} />
        <input type="range" className="ps-range ps-range-min"
          min={PS_MIN} max={PS_MAX} step={1000} value={minVal}
          onChange={e => { const v = Number(e.target.value); if (v < maxVal) onMinChange(v) }} />
        <input type="range" className="ps-range ps-range-max"
          min={PS_MIN} max={PS_MAX} step={1000} value={maxVal}
          onChange={e => { const v = Number(e.target.value); if (v > minVal) onMaxChange(v) }} />
      </div>
      <div className="ps-labels">
        <div className="ps-label-box">{fmtLabel(minVal, false)}</div>
        <div className="ps-label-box">{fmtLabel(maxVal, true)}</div>
      </div>
    </div>
  )
}

function SectionHeader({ label, open, onToggle, count }) {
  return (
    <div className="sidebar-acc-header" onClick={onToggle}>
      <span>{label}</span>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        {count > 0 && <span className="sidebar-acc-count">{count}</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--muted)' }}>
          <polyline points="2,3 5,7 8,3"/>
        </svg>
      </div>
    </div>
  )
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export default function DealerCatalog({ routeCategory }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  const params = new URLSearchParams(location.search)
  const urlBrand = params.get('brand') || ''
  const urlType = params.get('type') || ''
  const urlCategory = params.get('category') || ''
  const lockedCategory = routeCategory || urlCategory

  const { currency } = useCurrency()
  const { rate } = useExchangeRate()

  const [watches, setWatches] = useState([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterBrand, setFilterBrand] = useState(urlBrand)
  const [filterCond, setFilterCond] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [filterCategory, setFilterCategory] = useState(
    lockedCategory === 'Bags' ? (urlType || '') : lockedCategory
  )
  const [filterMetal, setFilterMetal] = useState('')
  const [filterSize, setFilterSize] = useState('')
  const [filterJewelleryType, setFilterJewelleryType] = useState(
    urlType && lockedCategory === 'Jewellery' ? urlType : ''
  )
  const [search, setSearch] = useState('')
  const [filterPriceMin, setFilterPriceMin] = useState(1000)
  const [filterPriceMax, setFilterPriceMax] = useState(150000)
  const [filterYearMin, setFilterYearMin] = useState('')
  const [filterYearMax, setFilterYearMax] = useState('')
  const [sortBy, setSortBy] = useState('')

  // UI state
  const [visibleCount, setVisibleCount] = useState(40)
  const sentinelRef = useRef(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('available')
  const [filterNewOnly, setFilterNewOnly] = useState(false)
  const [expanded, setExpanded] = useState({ category: true, brand: true, condition: true, availability: true, price: true, jewType: true, year: true })
  const [showAllConds, setShowAllConds] = useState(false)

  function toggleSec(k) { setExpanded(e => ({ ...e, [k]: !e[k] })) }

  function selectTab(tab) {
    setActiveTab(tab)
    setFilterNewOnly(tab === 'new')
    if (tab === 'all') setFilterStatus('')
    else if (tab === 'available') setFilterStatus('available')
    else if (tab === 'reserved') setFilterStatus('reserved')
    else if (tab === 'new') setFilterStatus('')
    setVisibleCount(40)
  }

  const fetchWatches = useCallback(async () => {
    let q = supabase.from('products').select('*, product_images(url, position)').order('created_at', { ascending: false })
    if (filterBrand) q = q.eq('brand', filterBrand)
    if (filterStatus) q = q.eq('status', filterStatus)
    else q = q.neq('status', 'sold')
    if (lockedCategory === 'Bags') {
      if (filterCategory) q = q.eq('category', filterCategory)
      else q = q.in('category', BAGS_CATEGORIES)
    } else if (lockedCategory) {
      q = q.eq('category', lockedCategory)
    } else if (filterCategory) {
      q = q.eq('category', filterCategory)
    }
    if (filterMetal) q = q.eq('metal_type', filterMetal)
    if (filterSize) q = q.eq('item_size', filterSize)

    let pq = supabase.from('preorders').select('*, preorder_images(url, position)').order('created_at', { ascending: false })
    if (filterBrand) pq = pq.eq('brand', filterBrand)
    if (filterStatus) pq = pq.eq('status', filterStatus)
    else pq = pq.neq('status', 'sold')
    if (lockedCategory === 'Bags') {
      if (filterCategory) pq = pq.eq('category', filterCategory)
      else pq = pq.in('category', BAGS_CATEGORIES)
    } else if (lockedCategory) {
      pq = pq.eq('category', lockedCategory)
    } else if (filterCategory) {
      pq = pq.eq('category', filterCategory)
    }
    if (filterMetal) pq = pq.eq('metal_type', filterMetal)
    if (filterSize) pq = pq.eq('item_size', filterSize)

    const [{ data: products }, { data: preorderData }] = await Promise.all([q, pq])
    const merged = [
      ...(products || []).filter(p => p.product_images && p.product_images.length > 0),
      ...(preorderData || []).map(p => ({ ...p, product_images: p.preorder_images || [] }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    setWatches(merged)
    setLoading(false)
  }, [filterBrand, filterStatus, filterCategory, filterMetal, filterSize, lockedCategory])

  useEffect(() => { fetchWatches() }, [fetchWatches])

  useEffect(() => {
    setFilterBrand(''); setFilterCond(''); setFilterMetal('')
    setFilterSize(''); setFilterJewelleryType(''); setFilterCategory('')
    setSearch(''); setVisibleCount(40)
  }, [location.pathname])

  useEffect(() => {
    const p = new URLSearchParams(location.search)
    setFilterBrand(p.get('brand') || '')
    if (lockedCategory === 'Jewellery') setFilterJewelleryType(p.get('type') || '')
    if (lockedCategory === 'Bags') setFilterCategory(p.get('type') || '')
  }, [location.search])

  useEffect(() => {
    const sub = supabase.channel('products-catalog')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchWatches)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [fetchWatches])

  const cutoff = useMemo(() => new Date(Date.now() - SEVEN_DAYS), [])

  const uniqueConditions = useMemo(() =>
    [...new Set(watches.map(w => w.condition).filter(Boolean))].sort(),
    [watches]
  )

  const filtered = watches
    .filter(w => {
      if (filterNewOnly && new Date(w.created_at) < cutoff) return false
      if (filterCond && w.condition !== filterCond) return false
      if (filterJewelleryType && inferJewelleryType(w) !== filterJewelleryType) return false
      if (filterPriceMin > 1000 && Number(w.price_eur) < filterPriceMin) return false
      if (filterPriceMax < 150000 && Number(w.price_eur) > filterPriceMax) return false
      if (filterYearMin && w.year && Number(w.year) < Number(filterYearMin)) return false
      if (filterYearMax && w.year && Number(w.year) > Number(filterYearMax)) return false
      if (!search) return true
      const q = search.toLowerCase()
      return w.model?.toLowerCase().includes(q) || w.reference?.toLowerCase().includes(q) || w.brand?.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (sortBy === 'price_asc') return (a.price_eur || 0) - (b.price_eur || 0)
      if (sortBy === 'price_desc') return (b.price_eur || 0) - (a.price_eur || 0)
      return 0
    })

  const paginated = filtered.slice(0, visibleCount)

  useEffect(() => setVisibleCount(40), [
    filterBrand, filterCond, filterStatus, search, sortBy,
    filterPriceMin, filterPriceMax, filterYearMin, filterYearMax,
    filterJewelleryType, filterMetal, filterSize, filterNewOnly
  ])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(v => v + 40)
    }, { threshold: 0.1 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [filtered.length, visibleCount])

  // Tab counts from full loaded data (before client filters)
  const allWatchesCount = watches.length
  const availableCount = watches.filter(w => w.status === 'available').length
  const newArrivalsCount = watches.filter(w => new Date(w.created_at) > cutoff).length
  const reservedCount = watches.filter(w => w.status === 'reserved').length

  // Hero image: pick first available product with image
  const heroImgUrl = useMemo(() => {
    const w = watches.find(item => item.status === 'available' && item.product_images?.length > 0)
    if (!w) return null
    return [...(w.product_images)].sort((a,b) => a.position - b.position)[0]?.url
  }, [watches])

  function clearAllFilters() {
    if (!lockedCategory) setFilterCategory('')
    setFilterBrand(''); setFilterCond(''); setFilterMetal('')
    setFilterSize(''); setFilterJewelleryType('')
    setSearch(''); setSortBy(''); setFilterPriceMin(1000); setFilterPriceMax(150000)
    setFilterYearMin(''); setFilterYearMax('')
    setFilterNewOnly(false)
    setFilterStatus('available')
    setActiveTab('available')
  }

  const hasActiveFilters = filterBrand || filterCond || filterMetal || filterSize ||
    filterJewelleryType || search || sortBy || filterPriceMin > 1000 || filterPriceMax < 150000 ||
    filterYearMin || filterYearMax || filterNewOnly || (!lockedCategory && filterCategory)

  const brandOptions = (
    lockedCategory === 'Watches' ? WATCH_BRANDS :
    lockedCategory === 'Jewellery' ? JEWELLERY_BRANDS :
    lockedCategory === 'Bags' ? [...new Set([...BAG_BRANDS,...SHOES_BRANDS,...ACCESSORIES_BRANDS])].sort() :
    ALL_BRANDS
  )

  const TABS = [
    { key: 'all', label: 'All Inventory', count: allWatchesCount },
    { key: 'available', label: 'Available Now', count: availableCount },
    { key: 'new', label: 'New Arrivals', count: newArrivalsCount },
    { key: 'reserved', label: 'Reserved', count: reservedCount },
  ]

  return (
    <div className="page">
      <Topbar />

      {/* Full-width search bar */}
      <div className="catalog-searchbar">
        <div className="catalog-searchbar-inner">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="csb-icon">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            className="csb-input"
            placeholder="Search by brand, model, reference or keyword..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="csb-btn">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </button>
        </div>
        <button className="csb-wtb" onClick={() => navigate('/agent')}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
          Submit WTB Request
        </button>
      </div>

      {/* Mobile filter bar */}
      <div className="mobile-filter-bar">
        <button className="filter-trigger-btn" onClick={() => setDrawerOpen(true)}>
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
          Filters
        </button>
        <input className="mobile-search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        <span className="results-count"><strong>{filtered.length}</strong></span>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="filter-drawer-bg" onClick={() => setDrawerOpen(false)}>
          <div className="filter-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <span className="drawer-title">Filters</span>
              <button className="drawer-close" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <div className="drawer-section">
              <div className="drawer-label">Brand</div>
              <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
                <option value="">All brands</option>
                {brandOptions.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div className="drawer-section">
              <div className="drawer-label">Condition</div>
              <select value={filterCond} onChange={e => setFilterCond(e.target.value)}>
                <option value="">All conditions</option>
                {uniqueConditions.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="drawer-section">
              <div className="drawer-label">Availability</div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
                <option value="">All status</option>
              </select>
            </div>
            <div className="drawer-section">
              <div className="drawer-label">Price range (EUR)</div>
              <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:4 }}>
                <input type="number" placeholder="Min" value={filterPriceMin} onChange={e => setFilterPriceMin(e.target.value)} />
                <span className="price-sep">—</span>
                <input type="number" placeholder="Max" value={filterPriceMax} onChange={e => setFilterPriceMax(e.target.value)} />
              </div>
            </div>
            <div className="drawer-section">
              <div className="drawer-label">Sort</div>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="">Newest First</option>
                <option value="price_asc">Price: Low → High</option>
                <option value="price_desc">Price: High → Low</option>
              </select>
            </div>
            <button className="drawer-apply" onClick={() => setDrawerOpen(false)}>Apply Filters</button>
          </div>
        </div>
      )}

      {/* Sidebar + content */}
      <div className="catalog-layout">

        {/* Sticky sidebar */}
        <aside className="catalog-sidebar">
          <div className="sidebar-header-row">
            <span className="sidebar-header-title">FILTERS</span>
            {hasActiveFilters && (
              <button className="sidebar-clear" onClick={clearAllFilters}>Clear all</button>
            )}
          </div>

          {/* Category */}
          {!lockedCategory && (
            <div className="sidebar-acc-section">
              <SectionHeader label="Category" open={expanded.category} onToggle={() => toggleSec('category')} />
              {expanded.category && (
                <div className="sidebar-acc-body">
                  <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterBrand(''); setFilterCond(''); setFilterJewelleryType('') }}>
                    <option value="">All Categories</option>
                    <option>Watches</option>
                    <option>Jewellery</option>
                    <option>Bags</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Bags sub-category */}
          {lockedCategory === 'Bags' && (
            <div className="sidebar-acc-section">
              <SectionHeader label="Type" open={expanded.category} onToggle={() => toggleSec('category')} />
              {expanded.category && (
                <div className="sidebar-acc-body">
                  <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterBrand('') }}>
                    <option value="">All</option>
                    <option>Bags</option><option>Accessories</option><option>Shoes</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Brand */}
          <div className="sidebar-acc-section">
            <SectionHeader label="Brand" open={expanded.brand} onToggle={() => toggleSec('brand')} count={filterBrand ? 1 : 0} />
            {expanded.brand && (
              <div className="sidebar-acc-body">
                <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
                  <option value="">All brands</option>
                  {brandOptions.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Condition */}
          <div className="sidebar-acc-section">
            <SectionHeader label="Condition" open={expanded.condition} onToggle={() => toggleSec('condition')} count={filterCond ? 1 : 0} />
            {expanded.condition && (
              <div className="sidebar-acc-body">
                <label className="sidebar-radio-row">
                  <input type="radio" name="cond" checked={filterCond === ''} onChange={() => setFilterCond('')} />
                  <span>All conditions</span>
                </label>
                {(showAllConds ? uniqueConditions : uniqueConditions.slice(0, 4)).map(cond => (
                  <label key={cond} className="sidebar-radio-row">
                    <input type="radio" name="cond" checked={filterCond === cond} onChange={() => setFilterCond(cond)} />
                    <span title={cond}>{cond.length > 22 ? cond.slice(0, 22) + '…' : cond}</span>
                  </label>
                ))}
                {uniqueConditions.length > 4 && (
                  <button className="sidebar-viewall-btn" onClick={() => setShowAllConds(v => !v)}>
                    {showAllConds ? 'View less' : `View all (${uniqueConditions.length})`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Jewellery type */}
          {lockedCategory === 'Jewellery' && (
            <div className="sidebar-acc-section">
              <SectionHeader label="Type" open={expanded.jewType} onToggle={() => toggleSec('jewType')} />
              {(expanded.jewType ?? true) && (
                <div className="sidebar-acc-body">
                  <select value={filterJewelleryType} onChange={e => { setFilterJewelleryType(e.target.value); setFilterSize('') }}>
                    <option value="">All types</option>
                    <option>Rings</option><option>Bracelets</option><option>Necklaces</option><option>Earrings</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Availability */}
          <div className="sidebar-acc-section">
            <SectionHeader label="Availability" open={expanded.availability} onToggle={() => toggleSec('availability')} />
            {expanded.availability && (
              <div className="sidebar-acc-body">
                {[
                  { val: 'available', label: 'Available Now', count: availableCount },
                  { val: '', label: 'All Inventory', count: allWatchesCount },
                  { val: 'reserved', label: 'Reserved', count: reservedCount },
                ].map(opt => (
                  <label key={opt.label} className="sidebar-radio-row">
                    <input type="radio" name="avail" checked={filterStatus === opt.val && !filterNewOnly}
                      onChange={() => { setFilterStatus(opt.val); setFilterNewOnly(false); setActiveTab(opt.val === 'available' ? 'available' : opt.val === '' ? 'all' : 'reserved') }} />
                    <span>{opt.label}</span>
                    <span className="sidebar-check-count">{opt.count}</span>
                  </label>
                ))}
                <label className="sidebar-radio-row">
                  <input type="radio" name="avail" checked={filterNewOnly}
                    onChange={() => { setFilterNewOnly(true); setFilterStatus(''); setActiveTab('new') }} />
                  <span>New Arrivals</span>
                  <span className="sidebar-check-count">{newArrivalsCount}</span>
                </label>
              </div>
            )}
          </div>

          {/* Year */}
          <div className="sidebar-acc-section">
            <SectionHeader label="Year" open={expanded.year} onToggle={() => toggleSec('year')} count={(filterYearMin || filterYearMax) ? 1 : 0} />
            {expanded.year && (
              <div className="sidebar-acc-body">
                <div className="sidebar-year-range">
                  <input type="number" placeholder="Min" min="1900" max="2030" value={filterYearMin} onChange={e => setFilterYearMin(e.target.value)} />
                  <span className="sidebar-range-dash">—</span>
                  <input type="number" placeholder="Max" min="1900" max="2030" value={filterYearMax} onChange={e => setFilterYearMax(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Price */}
          <div className="sidebar-acc-section">
            <SectionHeader label="Price (EUR)" open={expanded.price} onToggle={() => toggleSec('price')} count={(filterPriceMin > 1000 || filterPriceMax < 150000) ? 1 : 0} />
            {expanded.price && (
              <div className="sidebar-acc-body" style={{ paddingBottom: 14 }}>
                <PriceSlider
                  minVal={filterPriceMin}
                  maxVal={filterPriceMax}
                  onMinChange={setFilterPriceMin}
                  onMaxChange={setFilterPriceMax}
                />
              </div>
            )}
          </div>

          {/* Apply button */}
          <div className="sidebar-apply-wrap">
            <div className="sidebar-results-note">{filtered.length} items found</div>
            <button className="sidebar-apply-btn" onClick={() => {}}>Apply Filters</button>
          </div>
        </aside>

        {/* Main content */}
        <div className="catalog-content">

          {/* Hero */}
          {!loading && (
            <div className="catalog-hero" style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/hero-bg.jpg)`, backgroundSize: '58% auto', backgroundPosition: 'right center', backgroundRepeat: 'no-repeat' }}>
              <div className="hero-gradient-overlay" />
              <div className="hero-left">
                <div className="hero-eyebrow">
                  WELCOME BACK, {profile?.full_name ? profile.full_name.split(' ')[0].toUpperCase() : 'DEALER'} 👋
                </div>
                <h2 className="hero-headline">Source with confidence.</h2>
                <p className="hero-sub">
                  Access <strong>{availableCount}+</strong> pieces of authenticated luxury inventory<br />
                  from our trusted global network.
                </p>
                <div className="hero-trust-badges">
                  {TRUST_BADGES.map(b => (
                    <div key={b.label} className="hero-trust-badge">
                      <div className="hero-trust-icon">{b.icon}</div>
                      <div>
                        <div className="hero-trust-label">{b.label}</div>
                        <div className="hero-trust-sub">{b.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quick-filter tabs */}
          <div className="catalog-tabs-bar">
            <div className="catalog-tabs">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  className={`ctab ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => selectTab(tab.key)}
                >
                  {tab.label}
                  <span className="ctab-count">{tab.count}</span>
                </button>
              ))}
            </div>
            <div className="ctab-sortby">
              <span className="ctab-sort-label">Sort by</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="">Newest First</option>
                <option value="price_asc">Price: Low → High</option>
                <option value="price_desc">Price: High → Low</option>
              </select>
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="watch-grid">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="watch-card-skeleton">
                  <div className="sk-img skeleton" />
                  <div className="sk-body">
                    <div className="sk-brand skeleton" />
                    <div className="sk-model skeleton" />
                    <div className="sk-ref skeleton" />
                    <div className="sk-foot">
                      <div className="sk-price skeleton" />
                      <div className="sk-badge skeleton" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>◻</div>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>No items match your filters</div>
              {hasActiveFilters && (
                <button className="sidebar-clear" onClick={clearAllFilters} style={{ marginTop: 4 }}>
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="watch-grid">
                {paginated.map(w => {
                  const isNew = new Date(w.created_at) > cutoff
                  const waMsg = encodeURIComponent(`Hi, I'm interested in the ${w.brand} ${w.model}${w.reference ? ` (Ref. ${cleanRef(w.reference)})` : ''}. Is it still available?`)
                  const waNum = WA_NUMBERS[w.category] || '18488639660'
                  let badge = null
                  if (isNew && w.status === 'available') badge = { label: 'New Arrival', cls: 'card-badge-new' }
                  else if (w.status === 'reserved') badge = { label: 'Reserved', cls: 'card-badge-reserved' }
                  else if (w.status === 'available') badge = { label: 'Available', cls: 'card-badge-available' }

                  return (
                    <div className="watch-card" key={w.id}>
                      <div className="card-img-wrap" onClick={() => navigate(`/catalog/${w.id}`)}>
                        <CardImages watch={w} />
                        {badge && <div className={`card-badge ${badge.cls}`}>{badge.label}</div>}
                        <button className="card-bookmark" onClick={e => e.stopPropagation()} title="Save">
                          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                          </svg>
                        </button>
                      </div>
                      <div className="card-body" onClick={() => navigate(`/catalog/${w.id}`)}>
                        <div className="card-brand">{w.brand}</div>
                        <div className="card-model">{w.model}</div>
                        <div className="card-ref">{cleanRef(w.reference) ? `Ref. ${cleanRef(w.reference)}` : '—'}</div>
                        <div className="card-meta">
                          {w.notes && <span className="card-year">{w.notes}</span>}
                          {w.notes && shortenCond(w.condition) && <div className="card-dot" />}
                          {shortenCond(w.condition) && <span className="card-cond-pill">{shortenCond(w.condition)}</span>}
                        </div>
                      </div>
                      <div className="card-price-row">
                        <div className="card-price-block">
                          <div className="card-price">{fmtPrice(w, currency, rate)}</div>
                          <div className="card-price-label">Excl. VAT</div>
                        </div>
                        <div className="card-cta">
                          <a className="btn-wa" href={`https://wa.me/${waNum}?text=${waMsg}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                            {WA_SVG}
                          </a>
                          <button className="btn-inquire" onClick={() => navigate(`/catalog/${w.id}`)}>Inquire</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {visibleCount < filtered.length && (
                <div ref={sentinelRef} style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="spinner" />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom sections */}
      <div className="catalog-bottom">
        <div className="catalog-bottom-inner">
          <div className="cb-col cb-why">
            <div className="cb-title">Why Dealers Choose Us</div>
            {WHY_ITEMS.map(item => (
              <div key={item.title} className="cb-item">
                <div className="cb-item-icon">✓</div>
                <div>
                  <div className="cb-item-title">{item.title}</div>
                  <div className="cb-item-sub">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="cb-col cb-cta">
            <div className="cb-title">Need Something Specific?</div>
            <p className="cb-desc">
              Our global network can source rare and hard-to-find pieces for your collection or clients.
            </p>
            <button className="btn btn-dark" onClick={() => navigate('/agent')} style={{ marginTop: 16 }}>
              Submit WTB Request
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginLeft: 4 }}><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
            </button>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
