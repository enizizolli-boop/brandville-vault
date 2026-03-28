import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Topbar from '../components/Topbar'

const BRANDS = [
  'A. Lange & Söhne',
  'Audemars Piguet',
  'Balenciaga',
  'Blancpain',
  'Bottega Veneta',
  'Breguet',
  'Breitling',
  'Bulgari',
  'Cartier',
  'Celine',
  'Chanel',
  'Chopard',
  'De Beers',
  'Dior',
  'Fendi',
  'Girard-Perregaux',
  'Graff',
  'Grand Seiko',
  'Gucci',
  'Harry Winston',
  'Hermès',
  'Hublot',
  'IWC',
  'Jaeger-LeCoultre',
  'Loewe',
  'Louis Vuitton',
  'Mikimoto',
  'Omega',
  'Other',
  'Panerai',
  'Patek Philippe',
  'Piaget',
  'Prada',
  'Richard Mille',
  'Rolex',
  'Saint Laurent',
  'TAG Heuer',
  'Tiffany & Co',
  'Tudor',
  'Ulysse Nardin',
  'Vacheron Constantin',
  'Van Cleef & Arpels',
  'Zenith'
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
  const [currency, setCurrency] = useState('EUR')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterCond, setFilterCond] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterMetal, setFilterMetal] = useState('')
  const [filterSize, setFilterSize] = useState('')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const fetchWatches = useCallback(async () => {
    let q = supabase.from('watches').select('*, watch_images(url, position)').order('created_at', { ascending: false })
    if (filterBrand) q = q.eq('brand', filterBrand)
    if (filterCond) q = q.eq('condition', filterCond)
    if (filterStatus) q = q.eq('status', filterStatus)
    if (filterCategory) q = q.eq('category', filterCategory)
    if (filterMetal) q = q.eq('metal_type', filterMetal)
    if (filterSize) q = q.eq('item_size', filterSize)
    const { data } = await q
    setWatches(data || [])
    setLoading(false)
  }, [filterBrand, filterCond, filterStatus, filterCategory, filterMetal, filterSize])

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
        <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterMetal(''); setFilterSize('') }}>
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
        {filterCategory === 'Jewellery' && (
          <select value={filterMetal} onChange={e => setFilterMetal(e.target.value)}>
            <option value="">All metals</option>
            <option>Yellow Gold</option>
            <option>Pink Gold</option>
            <option>White Gold</option>
            <option>Platinum</option>
          </select>
        )}

        {filterCategory === 'Jewellery' && (
          <select value={filterSize} onChange={e => setFilterSize(e.target.value)}>
            <option value="">All sizes</option>
            <option>14</option>
            <option>15</option>
            <option>16</option>
            <option>17</option>
            <option>18</option>
            <option>19</option>
            <option>20</option>
            <option>21</option>
            <option>22</option>
            <option>23</option>
            <option>XS</option>
            <option>S</option>
            <option>M</option>
            <option>L</option>
            <option>XL</option>
            <option>XXL</option>
            <option>3XL</option>
          </select>
        )}
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
