import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCurrency } from '../context/CurrencyContext'
import { useExchangeRate } from '../hooks/useExchangeRate'
import Topbar from '../components/Topbar'

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

const ALL_BRANDS = [...new Set([...WATCH_BRANDS, ...JEWELLERY_BRANDS, ...BAG_BRANDS, ...SHOES_BRANDS, ...ACCESSORIES_BRANDS])].sort()

const CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair','Needs Repair','Repaired','Repaired Albania', 'Pre-owned'
]

const BRAND_EMOJI = { 'Rolex': '⌚', 'Patek Philippe': '🕰', 'Audemars Piguet': '⌚', 'Richard Mille': '⌚', 'Omega': '⌚', 'Cartier': '⌚', 'IWC': '⌚', 'Jaeger-LeCoultre': '⌚', 'Vacheron Constantin': '⌚', 'A. Lange & Söhne': '⌚' }

function cleanRef(ref) {
  if (!ref) return ''
  if (ref.includes('/')) return ref.split('/').filter(Boolean).pop()
  const numericSuffix = ref.match(/(\d+)$/)
  if (numericSuffix) return numericSuffix[1]
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
  if (/\b(?:earrings?|earings?|earing|ear-?rings?)\b/.test(text) || /\b(?:studs?|hoops?)\b/.test(text)) return 'Earrings'
  if (/\bbracelets?\b/.test(text) && !/watch\s+bracelet|bracelet\s*\(|strap|rubber|leather|metal\s+bracelet/i.test(text)) return 'Bracelets'
  if (/\bnecklaces?\b/.test(text)) return 'Necklaces'
  if (/\brings?\b/.test(text)) return 'Rings'
  return ''
}

const PLACEHOLDERS = {
  Watches: (
    <svg width="72" height="72" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="30" y="6" width="20" height="13" rx="3" stroke="#C9A87A" strokeWidth="1.5"/>
      <rect x="30" y="61" width="20" height="13" rx="3" stroke="#C9A87A" strokeWidth="1.5"/>
      <circle cx="40" cy="40" r="21" stroke="#C9A87A" strokeWidth="1.5"/>
      <circle cx="40" cy="40" r="2" fill="#C9A87A"/>
      <line x1="40" y1="38" x2="40" y2="25" stroke="#C9A87A" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="40" y1="40" x2="53" y2="46" stroke="#C9A87A" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="40" cy="22" r="1" fill="#C9A87A"/>
      <circle cx="40" cy="58" r="1" fill="#C9A87A"/>
      <circle cx="22" cy="40" r="1" fill="#C9A87A"/>
      <circle cx="58" cy="40" r="1" fill="#C9A87A"/>
    </svg>
  ),
  Jewellery: (
    <svg width="72" height="72" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="40,12 58,28 51,62 29,62 22,28" stroke="#C9A87A" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
      <line x1="22" y1="28" x2="40" y2="38" stroke="#C9A87A" strokeWidth="1.2"/>
      <line x1="58" y1="28" x2="40" y2="38" stroke="#C9A87A" strokeWidth="1.2"/>
      <line x1="40" y1="38" x2="29" y2="62" stroke="#C9A87A" strokeWidth="1.2"/>
      <line x1="40" y1="38" x2="51" y2="62" stroke="#C9A87A" strokeWidth="1.2"/>
      <line x1="22" y1="28" x2="58" y2="28" stroke="#C9A87A" strokeWidth="1.2"/>
      <line x1="40" y1="12" x2="22" y2="28" stroke="#C9A87A" strokeWidth="1.2"/>
      <line x1="40" y1="12" x2="58" y2="28" stroke="#C9A87A" strokeWidth="1.2"/>
    </svg>
  ),
  Bags: (
    <svg width="72" height="72" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M29 32 Q29 20 40 20 Q51 20 51 32" stroke="#C9A87A" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <rect x="16" y="32" width="48" height="30" rx="6" stroke="#C9A87A" strokeWidth="1.5" fill="none"/>
      <line x1="16" y1="44" x2="64" y2="44" stroke="#C9A87A" strokeWidth="1.2"/>
      <circle cx="40" cy="38" r="2.5" fill="#C9A87A"/>
    </svg>
  ),
}

function CategoryPlaceholder({ category }) {
  const svg = PLACEHOLDERS[category] || PLACEHOLDERS.Watches
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f2ed' }}>
      {svg}
    </div>
  )
}

function CardImages({ watch }) {
  const [idx, setIdx] = useState(0)
  const imgs = [...(watch.product_images || [])].sort((a, b) => a.position - b.position)
  const touchStartX = useRef(null)

  function prev(e) {
    e.stopPropagation()
    setIdx(i => Math.max(i - 1, 0))
  }
  function next(e) {
    e.stopPropagation()
    setIdx(i => Math.min(i + 1, imgs.length - 1))
  }
  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX }
  function onTouchEnd(e) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx < -40 && idx < imgs.length - 1) setIdx(i => i + 1)
    if (dx > 40 && idx > 0) setIdx(i => i - 1)
    touchStartX.current = null
  }

  if (!imgs.length) return <CategoryPlaceholder category={watch.category} />

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <img src={imgs[idx].url} alt={watch.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {imgs.length > 1 && idx > 0 && (
        <button onClick={prev} style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.35)', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: '50%', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>‹</button>
      )}
      {imgs.length > 1 && idx < imgs.length - 1 && (
        <button onClick={next} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.35)', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: '50%', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>›</button>
      )}
      {imgs.length > 1 && (
        <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 4 }}>
          {imgs.map((_, i) => (
            <div key={i} onClick={e => { e.stopPropagation(); setIdx(i) }}
              style={{ width: 5, height: 5, borderRadius: '50%', background: i === idx ? '#fff' : 'rgba(255,255,255,0.45)', cursor: 'pointer' }} />
          ))}
        </div>
      )}
    </div>
  )
}

const BAGS_CATEGORIES = ['Bags', 'Accessories', 'Shoes']

const WA_NUMBERS = { Watches: '18488639660', Bags: '18254757069', Jewellery: '17325061373' }
const WA_SVG = <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>

function shortenCond(cond) {
  if (!cond) return 'Pre-owned'
  if (cond.toLowerCase().includes('minor')) return 'Minor wear'
  if (cond.toLowerCase().includes('major')) return 'Major wear'
  return cond.split(' ').slice(0, 2).join(' ')
}

export default function DealerCatalog({ routeCategory }) {
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const urlCategory = params.get('category') || ''
  const urlBrand = params.get('brand') || ''
  const urlType = params.get('type') || ''
  const lockedCategory = routeCategory || urlCategory

  const { currency } = useCurrency()
  const { rate } = useExchangeRate()
  const gridRef = useRef(null)
  const [cols, setCols] = useState(5)
  const [watches, setWatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterBrand, setFilterBrand] = useState(urlBrand)
  const [filterCond, setFilterCond] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [filterCategory, setFilterCategory] = useState(lockedCategory === 'Bags' ? (urlType || '') : lockedCategory)
  const [filterMetal, setFilterMetal] = useState('')
  const [filterSize, setFilterSize] = useState('')
  const [filterJewelleryType, setFilterJewelleryType] = useState(urlType && lockedCategory === 'Jewellery' ? urlType : '')
  const [search, setSearch] = useState('')
  const [filterPriceMin, setFilterPriceMin] = useState('')
  const [filterPriceMax, setFilterPriceMax] = useState('')
  const [page, setPage] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sortBy, setSortBy] = useState('')

  const fetchWatches = useCallback(async () => {
    let q = supabase.from('products').select('*, product_images(url, position)').order('created_at', { ascending: false })
    if (filterBrand) q = q.eq('brand', filterBrand)
    if (filterCond) q = q.eq('condition', filterCond)
    if (filterStatus) {
      q = q.eq('status', filterStatus)
    } else {
      q = q.neq('status', 'sold')
    }
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
    if (filterCond) pq = pq.eq('condition', filterCond)
    if (filterStatus) {
      pq = pq.eq('status', filterStatus)
    } else {
      pq = pq.neq('status', 'sold')
    }
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
      ...(products || []),
      ...(preorderData || []).map(p => ({ ...p, product_images: p.preorder_images || [] }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    setWatches(merged)
    setLoading(false)
  }, [filterBrand, filterCond, filterStatus, filterCategory, filterMetal, filterSize, filterJewelleryType, lockedCategory])

  useEffect(() => { fetchWatches() }, [fetchWatches])

  useEffect(() => {
    const sub = supabase.channel('products-catalog').on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchWatches).subscribe()
    return () => supabase.removeChannel(sub)
  }, [fetchWatches])

  const filtered = watches
    .filter(w => {
      if (filterJewelleryType && inferJewelleryType(w) !== filterJewelleryType) return false
      if (filterPriceMin && Number(w.price_eur) < Number(filterPriceMin)) return false
      if (filterPriceMax && Number(w.price_eur) > Number(filterPriceMax)) return false
      if (!search) return true
      return w.model?.toLowerCase().includes(search.toLowerCase()) || w.reference?.toLowerCase().includes(search.toLowerCase())
    })
    .sort((a, b) => {
      if (sortBy === 'price_asc') return (a.price_eur || a.price_usd || 0) - (b.price_eur || b.price_usd || 0)
      if (sortBy === 'price_desc') return (b.price_eur || b.price_usd || 0) - (a.price_eur || a.price_usd || 0)
      if (sortBy === 'sku_asc') return (parseInt(cleanRef(a.reference), 10) || 0) - (parseInt(cleanRef(b.reference), 10) || 0)
      if (sortBy === 'sku_desc') return (parseInt(cleanRef(b.reference), 10) || 0) - (parseInt(cleanRef(a.reference), 10) || 0)
      return 0
    })

  const PAGE_SIZE = 40
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  useEffect(() => setPage(0), [filterBrand, filterCond, filterStatus, search, sortBy, filterPriceMin, filterPriceMax, filterJewelleryType, filterMetal, filterSize])

  useEffect(() => {
    function measureCols() {
      const grid = gridRef.current
      if (!grid) return
      const items = Array.from(grid.children).filter(el => !el.dataset.banner)
      if (items.length < 2) return
      const firstTop = items[0].getBoundingClientRect().top
      let count = 0
      for (const el of items) {
        if (Math.abs(el.getBoundingClientRect().top - firstTop) < 5) count++
        else break
      }
      if (count > 0) setCols(count)
    }
    const observer = new ResizeObserver(measureCols)
    if (gridRef.current) observer.observe(gridRef.current)
    const t = setTimeout(measureCols, 100)
    return () => { observer.disconnect(); clearTimeout(t) }
  }, [filtered.length])

  const avail = watches.filter(w => w.status === 'available').length
  const reserved = watches.filter(w => w.status === 'reserved').length
  const isWatches = lockedCategory === 'Watches'

  const activePills = [
    !lockedCategory && filterCategory && { label: filterCategory, clear: () => { setFilterCategory(''); setFilterMetal(''); setFilterSize(''); setFilterJewelleryType(''); setFilterCond('') } },
    lockedCategory === 'Bags' && filterCategory && { label: filterCategory, clear: () => setFilterCategory('') },
    filterBrand && { label: filterBrand, clear: () => setFilterBrand('') },
    filterCond && { label: filterCond.split(' ').slice(0,3).join(' ') + '…', clear: () => setFilterCond('') },
    filterStatus === 'reserved' && { label: 'Reserved', clear: () => setFilterStatus('available') },
    filterMetal && { label: filterMetal, clear: () => setFilterMetal('') },
    filterJewelleryType && { label: filterJewelleryType, clear: () => { setFilterJewelleryType(''); setFilterSize('') } },
    filterSize && { label: 'Size ' + filterSize, clear: () => setFilterSize('') },
    search && { label: `"${search}"`, clear: () => setSearch('') },
    sortBy && { label: sortBy === 'price_asc' ? 'Price ↑' : sortBy === 'price_desc' ? 'Price ↓' : sortBy === 'sku_asc' ? 'SKU ↑' : 'SKU ↓', clear: () => setSortBy('') },
  ].filter(Boolean)

  function clearAllFilters() {
    if (!lockedCategory) setFilterCategory('')
    setFilterBrand(''); setFilterCond(''); setFilterStatus('available')
    setFilterMetal(''); setFilterSize(''); setFilterJewelleryType('')
    setSearch(''); setSortBy(''); setFilterPriceMin(''); setFilterPriceMax('')
  }

  const brandOptions = (
    lockedCategory === 'Watches' ? WATCH_BRANDS :
    lockedCategory === 'Jewellery' ? JEWELLERY_BRANDS :
    lockedCategory === 'Bags' ? [...new Set([...BAG_BRANDS, ...SHOES_BRANDS, ...ACCESSORIES_BRANDS])].sort() :
    ALL_BRANDS
  )

  return (
    <div className="page">
      <Topbar />

      {/* Stats bar */}
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-val" style={{ color: 'var(--gold)' }}>{avail}</div><div className="stat-lbl">Available</div></div>
        <div className="stat-divider" />
        {reserved > 0 && <><div className="stat-card"><div className="stat-val">{reserved}</div><div className="stat-lbl">Reserved</div></div><div className="stat-divider" /></>}
        <div className="stat-card"><div className="stat-val">{watches.length}</div><div className="stat-lbl">Total</div></div>
      </div>

      {/* Desktop filter bar */}
      <div className="filter-bar">
        <div className="filter-group">
          {lockedCategory === 'Bags' && (
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterBrand('') }}>
              <option value=''>All</option><option>Bags</option><option>Accessories</option><option>Shoes</option>
            </select>
          )}
          <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
            <option value="">All brands</option>
            {brandOptions.map(b => <option key={b}>{b}</option>)}
          </select>
          {isWatches && (
            <select value={filterCond} onChange={e => setFilterCond(e.target.value)}>
              <option value="">All conditions</option>
              {CONDITIONS.map(c => <option key={c}>{c}</option>)}
            </select>
          )}
          {lockedCategory === 'Jewellery' && (
            <select value={filterJewelleryType} onChange={e => { setFilterJewelleryType(e.target.value); setFilterSize('') }}>
              <option value="">All types</option>
              <option>Rings</option><option>Bracelets</option><option>Necklaces</option><option>Earrings</option>
            </select>
          )}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="available">Available</option>
            <option value="reserved">Reserved</option>
            <option value="">All status</option>
          </select>
        </div>
        <div className="filter-divider" />
        <div className="price-range-group">
          <span className="price-label">€</span>
          <input className="price-input" type="number" placeholder="Min" value={filterPriceMin} onChange={e => setFilterPriceMin(e.target.value)} />
          <span className="price-sep">—</span>
          <input className="price-input" type="number" placeholder="Max" value={filterPriceMax} onChange={e => setFilterPriceMax(e.target.value)} />
        </div>
        <div className="filter-divider" />
        <div className="search-wrap">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="search-input" placeholder="Search model or ref…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-right">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="">Newest First</option>
            <option value="price_asc">Price: Low → High</option>
            <option value="price_desc">Price: High → Low</option>
            <option value="sku_asc">SKU: Old → New</option>
            <option value="sku_desc">SKU: New → Old</option>
          </select>
          <span className="results-count"><strong>{filtered.length}</strong> items</span>
        </div>
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
            {isWatches && (
              <div className="drawer-section">
                <div className="drawer-label">Condition</div>
                <select value={filterCond} onChange={e => setFilterCond(e.target.value)}>
                  <option value="">All conditions</option>
                  {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
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

      {/* Active filter pills */}
      {activePills.length > 0 && (
        <div className="filter-pills">
          {activePills.map((p, i) => (
            <span key={i} className="filter-pill" onClick={p.clear}>{p.label} <span className="filter-pill-x">×</span></span>
          ))}
          {activePills.length > 1 && (
            <span className="filter-clear-all" onClick={clearAllFilters}>Clear all</span>
          )}
        </div>
      )}

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
          {activePills.length > 0 && <span className="filter-clear-all" onClick={clearAllFilters} style={{ fontSize: 13 }}>Clear all filters</span>}
        </div>
      ) : (
        <>
          <div className="watch-grid" ref={gridRef}>
            {paginated.map((w, idx) => {
              const bannerAt = cols * 4
              const waMsg = encodeURIComponent(`Hi, I'm interested in the ${w.brand} ${w.model}${w.reference ? ` (Ref. ${cleanRef(w.reference)})` : ''}. Is it still available?`)
              const waNum = WA_NUMBERS[w.category] || '18488639660'
              return (
                <React.Fragment key={w.id}>
                  {idx === bannerAt && bannerAt > 0 && (
                    <div data-banner="1" style={{ gridColumn: '1 / -1', margin: '4px 0' }}>
                      <a href="https://chasovnikari.com/checkout/" target="_blank" rel="noopener noreferrer" className="catalog-banner">
                        <img src="/banner-repair.png" alt="KK Time Studio — Watchmaking repair service" />
                      </a>
                    </div>
                  )}
                  <div className="watch-card">
                    <div className="card-img-wrap" onClick={() => navigate(`/catalog/${w.id}`)}>
                      <CardImages watch={w} />
                      <div className={`card-status-dot ${w.status}`} />
                    </div>
                    <div className="card-body" onClick={() => navigate(`/catalog/${w.id}`)}>
                      <div className="card-brand">{w.brand}</div>
                      <div className="card-model">{w.model}</div>
                      <div className="card-ref">{cleanRef(w.reference) ? `Ref. ${cleanRef(w.reference)}` : '—'}</div>
                      <div className="card-meta">
                        {w.notes && <><span className="card-year">{w.notes}</span><div className="card-dot" /></>}
                        <span className="card-cond-pill">{shortenCond(w.condition)}</span>
                      </div>
                    </div>
                    <div className="card-price-row">
                      <div className="card-price-block">
                        <div className="card-price">{fmtPrice(w, currency, rate)}</div>
                        <div className="card-price-label">Asking price</div>
                      </div>
                      <div className="card-cta">
                        <a className="btn-wa" href={`https://wa.me/${waNum}?text=${waMsg}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                          {WA_SVG}
                        </a>
                        <button className="btn-inquire" onClick={() => navigate(`/catalog/${w.id}`)}>
                          Inquire
                        </button>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="page-btn arrow" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
              {Array.from({ length: totalPages }, (_, i) => {
                if (totalPages <= 7 || i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1) {
                  return <button key={i} className={`page-btn ${i === page ? 'active' : ''}`} onClick={() => { setPage(i); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{i + 1}</button>
                }
                if (Math.abs(i - page) === 2) return <span key={i} className="page-ellipsis">…</span>
                return null
              })}
              <button className="page-btn arrow" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>›</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}