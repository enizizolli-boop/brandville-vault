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

const ALL_BRANDS = [...new Set([...WATCH_BRANDS, ...JEWELLERY_BRANDS, ...BAG_BRANDS])].sort()

const CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair','Needs Repair','Repaired','Repaired Albania',
]

const BRAND_EMOJI = { 'Rolex': '⌚', 'Patek Philippe': '🕰', 'Audemars Piguet': '⌚', 'Richard Mille': '⌚', 'Omega': '⌚', 'Cartier': '⌚', 'IWC': '⌚', 'Jaeger-LeCoultre': '⌚', 'Vacheron Constantin': '⌚', 'A. Lange & Söhne': '⌚' }

function cleanRef(ref) {
  if (!ref) return ''
  // Only strip brand prefixes (parts before /), keep hyphenated refs intact
  if (ref.includes('/')) return ref.split('/').filter(Boolean).pop()
  return ref
}

function fmtPrice(watch, currency, rate) {
  if (currency === 'USD') {
    if (watch.price_usd) return '$' + Number(watch.price_usd).toLocaleString()
    if (watch.price_eur && rate) return '$' + Math.round(Number(watch.price_eur) * rate).toLocaleString()
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

function CardImages({ watch, brandEmoji }) {
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

  if (!imgs.length) return <span>{brandEmoji}</span>

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

export default function DealerCatalog() {
  const navigate = useNavigate()
  const location = useLocation()
  const urlCategory = new URLSearchParams(location.search).get('category') || ''

  const { currency } = useCurrency()
  const { rate } = useExchangeRate()
  const gridRef = useRef(null)
  const [cols, setCols] = useState(5)
  const [watches, setWatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterBrand, setFilterBrand] = useState('')
  const [filterCond, setFilterCond] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [filterCategory, setFilterCategory] = useState(urlCategory)
  const [filterMetal, setFilterMetal] = useState('')
  const [filterSize, setFilterSize] = useState('')
  const [filterJewelleryType, setFilterJewelleryType] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('')

  const fetchWatches = useCallback(async () => {
    let q = supabase.from('products').select('*, product_images(url, position)').order('created_at', { ascending: false })
    if (filterBrand) q = q.eq('brand', filterBrand)
    if (filterCond) q = q.eq('condition', filterCond)
    if (filterStatus) {
      q = q.eq('status', filterStatus)
    } else {
      // Never show sold items even when "All status" is selected
      q = q.neq('status', 'sold')
    }
    if (filterCategory) q = q.eq('category', filterCategory)
    if (filterMetal) q = q.eq('metal_type', filterMetal)
    if (filterSize) q = q.eq('item_size', filterSize)
    const { data } = await q
    setWatches(data || [])
    setLoading(false)
  }, [filterBrand, filterCond, filterStatus, filterCategory, filterMetal, filterSize, filterJewelleryType])

  useEffect(() => { fetchWatches() }, [fetchWatches])

  useEffect(() => {
    const sub = supabase.channel('products-catalog').on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchWatches).subscribe()
    return () => supabase.removeChannel(sub)
  }, [fetchWatches])

  const filtered = watches
    .filter(w => {
      if (filterJewelleryType && inferJewelleryType(w) !== filterJewelleryType) return false
      if (!search) return true
      return w.model?.toLowerCase().includes(search.toLowerCase()) || w.reference?.toLowerCase().includes(search.toLowerCase())
    })
    .sort((a, b) => {
      if (sortBy === 'price_asc') return (a.price_eur || a.price_usd || 0) - (b.price_eur || b.price_usd || 0)
      if (sortBy === 'price_desc') return (b.price_eur || b.price_usd || 0) - (a.price_eur || a.price_usd || 0)
      if (sortBy === 'sku_asc') return cleanRef(a.reference).localeCompare(cleanRef(b.reference))
      if (sortBy === 'sku_desc') return cleanRef(b.reference).localeCompare(cleanRef(a.reference))
      return 0
    })

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
  const isWatches = filterCategory === 'Watches' || filterCategory === ''

  const activePills = [
    filterCategory && { label: filterCategory, clear: () => { setFilterCategory(''); setFilterMetal(''); setFilterSize(''); setFilterJewelleryType(''); setFilterCond('') } },
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
    setFilterCategory(''); setFilterBrand(''); setFilterCond(''); setFilterStatus('available')
    setFilterMetal(''); setFilterSize(''); setFilterJewelleryType(''); setSearch(''); setSortBy('')
  }

  return (
    <div className="page">
      <Topbar />
      {urlCategory && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 0' }}>
          <button className="btn btn-sm" onClick={() => navigate('/home')}>← Back</button>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{urlCategory}</span>
        </div>
      )}
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-val">{avail}</div><div className="stat-lbl">Available</div></div>
        <div className="stat-card"><div className="stat-val">{reserved}</div><div className="stat-lbl">Reserved</div></div>
        <div className="stat-card"><div className="stat-val">{watches.length}</div><div className="stat-lbl">Total in stock</div></div>
      </div>
      <div className="filters">
        <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterBrand(''); setFilterMetal(''); setFilterSize(''); setFilterJewelleryType(''); setFilterCond('') }}>
          <option value=''>All categories</option>
          <option>Watches</option><option>Jewellery</option><option>Bags</option>
        </select>
        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
          <option value="">All brands</option>
          {(filterCategory === 'Watches' ? WATCH_BRANDS : filterCategory === 'Jewellery' ? JEWELLERY_BRANDS : filterCategory === 'Bags' ? BAG_BRANDS : ALL_BRANDS).map(b => <option key={b}>{b}</option>)}
        </select>
        {isWatches && (
          <select value={filterCond} onChange={e => setFilterCond(e.target.value)}>
            <option value="">All conditions</option>
            {CONDITIONS.map(c => <option key={c}>{c}</option>)}
          </select>
        )}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="available">Available</option>
          <option value="reserved">Reserved</option>
          <option value="">All status</option>
        </select>
        <input placeholder="Search model or ref..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
        {filterCategory === 'Jewellery' && (
          <select value={filterMetal} onChange={e => setFilterMetal(e.target.value)}>
            <option value="">All metals</option>
            <option>Yellow Gold</option><option>Pink Gold</option><option>White Gold</option><option>Platinum</option>
          </select>
        )}
        {filterCategory === 'Jewellery' && (
          <select value={filterJewelleryType} onChange={e => { setFilterJewelleryType(e.target.value); setFilterSize('') }}>
            <option value="">All types</option>
            <option>Rings</option><option>Bracelets</option><option>Necklaces</option><option>Earrings</option>
          </select>
        )}
        {filterCategory === 'Jewellery' && filterJewelleryType === 'Rings' && (
          <select value={filterSize} onChange={e => setFilterSize(e.target.value)}>
            <option value="">All sizes</option>
            {['50','51','52','53','54','55','56','57','58','59','60','61','62','63','64','65'].map(s => <option key={s}>{s}</option>)}
          </select>
        )}
        {filterCategory === 'Jewellery' && filterJewelleryType === 'Bracelets' && (
          <select value={filterSize} onChange={e => setFilterSize(e.target.value)}>
            <option value="">All sizes</option>
            {['14','15','16','17','18','19','20','21','22','23','XS','S','M','L','XL','XXL','3XL'].map(s => <option key={s}>{s}</option>)}
          </select>
        )}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="">Sort: Default</option>
          <option value="price_asc">Price: Low → High</option>
          <option value="price_desc">Price: High → Low</option>
          <option value="sku_asc">SKU: Old → New</option>
          <option value="sku_desc">SKU: New → Old</option>
        </select>
        <span className="filter-count">{filtered.length} items</span>
      </div>

      {activePills.length > 0 && (
        <div className="filter-pills">
          {activePills.map((p, i) => (
            <span key={i} className="filter-pill" onClick={p.clear}>
              {p.label} <span className="filter-pill-x">×</span>
            </span>
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
                <div className="sk-model2 skeleton" />
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
        <div className="watch-grid" ref={gridRef}>
          {filtered.map((w, idx) => {
            const bannerAt = cols * 4
            return (<React.Fragment key={w.id}>
              {idx === bannerAt && bannerAt > 0 && (
                <div data-banner="1" style={{ gridColumn: '1 / -1', margin: '4px 0' }}>
                  <a href="https://chasovnikari.com/checkout/" target="_blank" rel="noopener noreferrer" className="catalog-banner">
                    <img src="/banner-repair.png" alt="KK Time Studio — Watchmaking repair service" />
                  </a>
                </div>
              )}
              <div className="watch-card" onClick={() => navigate(`/catalog/${w.id}`)}>
                <div className="watch-card-img">
                  <CardImages watch={w} brandEmoji={BRAND_EMOJI[w.brand] || '⌚'} />
                </div>
                <div className="watch-card-body">
                  <div className="watch-card-brand">{w.category ? w.category + ' · ' : ''}{w.brand}</div>
                  <div className="watch-card-model">{w.model}</div>
                  <div className="watch-card-ref">{cleanRef(w.reference) || '—'}</div>
                  <div className="watch-card-foot">
                    <span className="watch-card-price">{fmtPrice(w, currency, rate)}</span>
                    <span className={`badge badge-${w.status}`}>{w.status}</span>
                  </div>
                </div>
              </div>
            </React.Fragment>)}
          )}
        </div>
      )}
    </div>
  )
}