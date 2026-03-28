import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useExchangeRate } from '../hooks/useExchangeRate'
import Topbar from '../components/Topbar'

const CATEGORIES = ['Watches', 'Jewellery', 'Bags']

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

const EMPTY_FORM = { category: 'Watches', brand: 'Rolex', model: '', reference: '', condition: 'Unworn', price_eur: '', notes: '', metal_type: '', item_size: '' }

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
  const [currency, setCurrency] = useState('EUR')

  const fetchMyWatches = useCallback(async () => {
    const q = profile?.role === 'admin'
      ? supabase.from('watches').select('*, watch_images(url, position)').order('created_at', { ascending: false })
      : supabase.from('watches').select('*, watch_images(url, position)').eq('posted_by', profile?.id).order('created_at', { ascending: false })
    const { data } = await q
    setWatches(data || [])
    setLoading(false)
  }, [profile])

  useEffect(() => { if (profile) fetchMyWatches() }, [profile, fetchMyWatches])

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
      const { data: watch, error: wErr } = await supabase.from('watches').insert({
        category: form.category,
        brand: form.brand,
        model: form.model,
        reference: form.reference || null,
        condition: form.condition,
        price_eur: Number(form.price_eur),
        price_usd: priceUsd,
        notes: form.notes || null,
        metal_type: form.category === 'Jewellery' && form.metal_type ? form.metal_type : null,
        item_size: form.category === 'Jewellery' && form.item_size ? form.item_size : null,
        posted_by: profile.id,
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
        await supabase.from('watch_images').insert({ watch_id: watch.id, url: publicUrl, position: i })
      }

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

  async function markSold(id) {
    await supabase.from('watches').update({ status: 'sold' }).eq('id', id)
    fetchMyWatches()
  }

  async function deleteWatch(id) {
    if (!window.confirm('Delete this item?')) return
    await supabase.from('watches').delete().eq('id', id)
    fetchMyWatches()
  }

  function fmtPrice(w) {
    if (currency === 'EUR' && w.price_eur) return '€' + Number(w.price_eur).toLocaleString()
    if (w.price_usd) return '$' + Number(w.price_usd).toLocaleString()
    return '—'
  }

  function getThumb(w) {
    const imgs = [...(w.watch_images || [])].sort((a, b) => a.position - b.position)
    return imgs[0]?.url || null
  }

  return (
    <div className="page">
      <Topbar currency={currency} onCurrencyChange={setCurrency} />
      <div className="tabs">
        <div className={`tab ${tab === 'listings' ? 'active' : ''}`} onClick={() => setTab('listings')}>My listings</div>
        <div className={`tab ${tab === 'post' ? 'active' : ''}`} onClick={() => setTab('post')}>Post new item</div>
      </div>

      {tab === 'listings' && (
        <div style={{ padding: 16 }}>
          {msg && <div className="success-msg" style={{ marginBottom: 12 }}>{msg}</div>}
          {loading ? <div className="loading-page" style={{ minHeight: 200 }}><div className="spinner" /></div>
            : watches.length === 0 ? <div className="empty-state">No items posted yet</div>
            : watches.map(w => (
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
                  <option>Unworn</option><option>Excellent</option><option>Good</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <label>Model name</label>
              <input value={form.model} onChange={e => handleField('model', e.target.value)} placeholder="e.g. Daytona, Birkin, Love Bracelet" required />
            </div>

            {form.category === 'Jewellery' && (
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
            )}
            {form.category === 'Jewellery' && (
              <div className="form-row">
                <label>Size</label>
                <select value={form.item_size} onChange={e => handleField('item_size', e.target.value)}>
                  <option value="">Select size</option>
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
              </div>
            )}
            <div className="form-row">
              <label>Reference / Serial</label>
              <input value={form.reference} onChange={e => handleField('reference', e.target.value)} placeholder="e.g. 116500LN" />
            </div>

            <div className="form-row">
              <label>Price (€ EUR)</label>
              <input
                type="number"
                value={form.price_eur}
                onChange={e => handleField('price_eur', e.target.value)}
                placeholder="e.g. 35000"
                required
              />
              {usdPreview && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  ≈ {usdPreview} USD <span style={{ color: '#bbb' }}>(live rate)</span>
                </div>
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
