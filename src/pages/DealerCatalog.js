import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Topbar from '../components/Topbar'

const BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Omega', 'Cartier', 'IWC', 'Jaeger-LeCoultre', 'Vacheron Constantin', 'A. Lange & Söhne']
const BRAND_EMOJI = { 'Rolex': '⌚', 'Patek Philippe': '🕰', 'Audemars Piguet': '⌚', 'Richard Mille': '⌚', 'Omega': '⌚', 'Cartier': '⌚', 'IWC': '⌚', 'Jaeger-LeCoultre': '⌚', 'Vacheron Constantin': '⌚', 'A. Lange & Söhne': '⌚' }

function fmtPrice(watch, currency) {
  if (currency === 'EUR' && watch.price_eur) return '€' + Number(watch.price_eur).toLocaleString()
  if (watch.price_usd) return '$' + Number(watch.price_usd).toLocaleString()
  return '—'
}

export default function DealerCatalog() {
  const [watches, setWatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState('USD')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterCond, setFilterCond] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const fetchWatches = useCallback(async () => {
    let q = supabase.from('watches').select('*, watch_images(url, position)').order('created_at', { ascending: false })
    if (filterBrand) q = q.eq('brand', filterBrand)
    if (filterCond) q = q.eq('condition', filterCond)
    if (filterStatus) q = q.eq('status', filterStatus)
    if (filterCategory) q = q.eq('category', filterCategory)
    const { data } = await q
    setWatches(data || [])
    setLoading(false)
  }, [filterBrand, filterCond, filterStatus, filterCategory])

  useEffect(() => { fetchWatches() }, [fetchWatches])

  useEffect(() => {
    const sub = supabase.channel('watches-catalog').on('postgres_changes', { event: '*', schema: 'public', table: 'watches' }, fetchWatches).subscribe()
    return () => supabase.removeChannel(sub)
  }, [fetchWatches])

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
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-val">{avail}</div><div className="stat-lbl">Available</div></div>
        <div className="stat-card"><div className="stat-val">{reserved}</div><div className="stat-lbl">Reserved</div></div>
        <div className="stat-card"><div className="stat-val">{watches.length}</div><div className="stat-lbl">Total in stock</div></div>
      </div>
      <div className="filters">
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value=''>All categories</option>
          <option>Watches</option><option>Jewellery</option><option>Bags</option>
        </select>
        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
          <option value="">All brands</option>
          {BRANDS.map(b => <option key={b}>{b}</option>)}
        </select>
        <select value={filterCond} onChange={e => setFilterCond(e.target.value)}>
          <option value="">All conditions</option>
          <option>Unworn</option>
          <option>Excellent</option>
          <option>Good</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All status</option>
          <option value="available">Available</option>
          <option value="reserved">Reserved</option>
        </select>
        <input placeholder="Search model or ref..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
        <span className="filter-count">{filtered.length} watches</span>
      </div>
      {loading ? (
        <div className="loading-page"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No watches match your filters</div>
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
