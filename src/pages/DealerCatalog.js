import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Topbar from '../components/Topbar'

const BRANDS = [
  'A. Lange & Söhne','Audemars Piguet','Balenciaga','Blancpain','Bottega Veneta',
  'Breguet','Breitling','Bulgari','Cartier','Celine','Chanel','Chopard','De Beers',
  'Dior','Fendi','Girard-Perregaux','Graff','Grand Seiko','Gucci','Harry Winston',
  'Hermès','Hublot','IWC','Jaeger-LeCoultre','Loewe','Louis Vuitton','Mikimoto',
  'Omega','Other','Panerai','Patek Philippe','Piaget','Prada','Richard Mille','Rolex',
  'Saint Laurent','TAG Heuer','Tiffany & Co','Tudor','Ulysse Nardin','Vacheron Constantin',
  'Van Cleef & Arpels','Zenith'
]

const CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair',
  'Needs Repair',
  'Repaired',
  'Repaired Albania',
]

const BRAND_EMOJI = { 'Rolex': '⌚', 'Patek Philippe': '🕰', 'Audemars Piguet': '⌚', 'Richard Mille': '⌚', 'Omega': '⌚', 'Cartier': '⌚', 'IWC': '⌚', 'Jaeger-LeCoultre': '⌚', 'Vacheron Constantin': '⌚', 'A. Lange & Söhne': '⌚' }

function fmtPrice(watch, currency) {
  if (currency === 'EUR' && watch.price_eur) return '€' + Number(watch.price_eur).toLocaleString()
  if (watch.price_usd) return '$' + Number(watch.price_usd).toLocaleString()
  return '—'
}

export default function DealerCatalog() {
  const [watches, setWatches] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()
  const urlCategory = new URLSearchParams(location.search).get('category') || ''

  const [currency, setCurrency] = useState('EUR')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterCond, setFilterCond] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [filterCategory, setFilterCategory] = useState(urlCategory)
  const [filterMetal, setFilterMetal] = useState('')
  const [filterSize, setFilterSize] = useState('')
  const [filterJewelleryType, setFilterJewelleryType] = useState('')
  const [search, setSearch] = useState('')
  const [brandCounts, setBrandCounts] = useState({})
  const [conditionCounts, setConditionCounts] = useState({})
  const [metalCounts, setMetalCounts] = useState({})
  const [jewelleryCounts, setJewelleryCounts] = useState({})
  const [sizeCounts, setSizeCounts] = useState({})

  const fetchWatches = useCallback(async () => {
    let q = supabase.from('watches').select('*, watch_images(url, position)').order('created_at', { ascending: false })
    if (filterBrand) q = q.eq('brand', filterBrand)
    if (filterCond) q = q.eq('condition', filterCond)
    if (filterStatus) q = q.eq('status', filterStatus)
    if (filterCategory) q = q.eq('category', filterCategory)
    if (filterMetal) q = q.eq('metal_type', filterMetal)
    if (filterSize) q = q.eq('item_size', filterSize)
    if (filterJewelleryType) q = q.eq('jewellery_type', filterJewelleryType)
    const { data } = await q
    setWatches(data || [])
    setLoading(false)
  }, [filterBrand, filterCond, filterStatus, filterCategory, filterMetal, filterSize, filterJewelleryType])

  useEffect(() => { fetchWatches() }, [fetchWatches])

  const fetchBrandCounts = useCallback(async () => {
    let q = supabase.from('watches').select('brand, condition, metal_type, jewellery_type, item_size')
    // Important: do NOT apply filterBrand here, so the dropdown reflects "what's in stock"
    // within the current non-brand filters.
    if (filterCond) q = q.eq('condition', filterCond)
    if (filterStatus) q = q.eq('status', filterStatus)
    if (filterCategory) q = q.eq('category', filterCategory)
    if (filterMetal) q = q.eq('metal_type', filterMetal)
    if (filterSize) q = q.eq('item_size', filterSize)
    if (filterJewelleryType) q = q.eq('jewellery_type', filterJewelleryType)
    const { data } = await q
    const brandCounts = {}
    const condCounts = {}
    const metalCts = {}
    const jewelleryCts = {}
    const sizeCts = {}
    for (const row of data || []) {
      if (row?.brand) brandCounts[row.brand] = (brandCounts[row.brand] || 0) + 1
      if (row?.condition) condCounts[row.condition] = (condCounts[row.condition] || 0) + 1
      if (row?.metal_type) metalCts[row.metal_type] = (metalCts[row.metal_type] || 0) + 1
      if (row?.jewellery_type) jewelleryCts[row.jewellery_type] = (jewelleryCts[row.jewellery_type] || 0) + 1
      if (row?.item_size) sizeCts[row.item_size] = (sizeCts[row.item_size] || 0) + 1
    }
    setBrandCounts(brandCounts)
    setConditionCounts(condCounts)
    setMetalCounts(metalCts)
    setJewelleryCounts(jewelleryCts)
    setSizeCounts(sizeCts)
  }, [filterCond, filterStatus, filterCategory, filterMetal, filterSize, filterJewelleryType])

  useEffect(() => { fetchBrandCounts() }, [fetchBrandCounts])

  useEffect(() => {
    const sub = supabase.channel('watches-catalog').on('postgres_changes', { event: '*', schema: 'public', table: 'watches' }, fetchWatches).subscribe()
    return () => supabase.removeChannel(sub)
  }, [fetchWatches])

  useEffect(() => {
    const sub = supabase.channel('watches-brand-counts').on('postgres_changes', { event: '*', schema: 'public', table: 'watches' }, fetchBrandCounts).subscribe()
    return () => supabase.removeChannel(sub)
  }, [fetchBrandCounts])

  useEffect(() => {
    if (!filterBrand) return
    if ((brandCounts[filterBrand] || 0) > 0) return
    setFilterBrand('')
  }, [filterBrand, brandCounts])

  const filtered = watches.filter(w =>
    !search || w.model?.toLowerCase().includes(search.toLowerCase()) || w.reference?.toLowerCase().includes(search.toLowerCase())
  )

  const avail = watches.filter(w => w.status === 'available').length
  const reserved = watches.filter(w => w.status === 'reserved').length

  function getThumb(watch) {
    const imgs = watch.watch_images || []
    const sorted = [...imgs].sort((a, b) => a.position - b.position)
    return sorted[0]?.url || null
  }

  return (
    <div className="page">
      <Topbar currency={currency} onCurrencyChange={setCurrency} />
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
        <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterCond(''); setFilterMetal(''); setFilterSize(''); setFilterJewelleryType('') }}>
          <option value=''>All categories</option>
          <option>Watches</option><option>Jewellery</option><option>Bags</option>
        </select>
        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
          <option value="">All brands</option>
          {BRANDS.filter(b => (brandCounts[b] || 0) > 0).map(b => <option key={b}>{b}</option>)}
        </select>
        {filterCategory === '' || filterCategory === 'Watches' ? (
          <select value={filterCond} onChange={e => setFilterCond(e.target.value)}>
            <option value="">All conditions</option>
            {CONDITIONS.filter(c => (conditionCounts[c] || 0) > 0).map(c => <option key={c}>{c}</option>)}
          </select>
        ) : null}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All status</option>
          <option value="available">Available</option>
          <option value="reserved">Reserved</option>
        </select>
        <input placeholder="Search model or ref..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
        {filterCategory === 'Jewellery' && (
          <select value={filterMetal} onChange={e => setFilterMetal(e.target.value)}>
            <option value="">All metals</option>
            {['Yellow Gold', 'Pink Gold', 'White Gold', 'Platinum'].filter(m => (metalCounts[m] || 0) > 0).map(m => <option key={m}>{m}</option>)}
          </select>
        )}
        {filterCategory === 'Jewellery' && (
          <select value={filterJewelleryType} onChange={e => { setFilterJewelleryType(e.target.value); setFilterSize('') }}>
            <option value="">All types</option>
            {['Rings', 'Bracelets', 'Necklaces'].filter(t => (jewelleryCounts[t] || 0) > 0).map(t => <option key={t}>{t}</option>)}
          </select>
        )}
        {filterCategory === 'Jewellery' && filterJewelleryType === 'Rings' && (
          <select value={filterSize} onChange={e => setFilterSize(e.target.value)}>
            <option value="">All sizes</option>
            {['50','51','52','53','54','55','56','57','58','59','60','61','62','63','64','65'].filter(s => (sizeCounts[s] || 0) > 0).map(s => <option key={s}>{s}</option>)}
          </select>
        )}
        {filterCategory === 'Jewellery' && filterJewelleryType === 'Bracelets' && (
          <select value={filterSize} onChange={e => setFilterSize(e.target.value)}>
            <option value="">All sizes</option>
            {['14','15','16','17','18','19','20','21','22','23','XS','S','M','L','XL','XXL','3XL'].filter(s => (sizeCounts[s] || 0) > 0).map(s => <option key={s}>{s}</option>)}
          </select>
        )}
        <span className="filter-count">{filtered.length} items</span>
      </div>
      {loading ? (
        <div className="loading-page"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No items match your filters</div>
      ) : (
        <div className="watch-grid">
          {filtered.map(w => (
            <div key={w.id} className="watch-card" onClick={() => navigate(`/catalog/${w.id}`)}>
              <div className="watch-card-img">
                {getThumb(w) ? <img src={getThumb(w)} alt={w.model} /> : <span>{BRAND_EMOJI[w.brand] || '⌚'}</span>}
              </div>
              <div className="watch-card-body">
                <div className="watch-card-brand">{w.category ? w.category + ' · ' : ''}{w.brand}</div>
                <div className="watch-card-model">{w.model}</div>
                <div className="watch-card-ref">{w.reference || '—'}</div>
                <div className="watch-card-foot">
                  <span className="watch-card-price">{fmtPrice(w, currency)}</span>
                  <span className={`badge badge-${w.status}`}>{w.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
