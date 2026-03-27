import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'

const BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Omega', 'Cartier', 'IWC', 'Jaeger-LeCoultre', 'Vacheron Constantin', 'A. Lange & Söhne']

const EMPTY_FORM = { brand: 'Rolex', model: '', reference: '', condition: 'Unworn', price_usd: '', price_eur: '', notes: '' }

export default function AgentListings() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('listings')
  const [watches, setWatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [images, setImages] = useState([])
  const [previews, setPreviews] = useState([])
  const [posting, setPosting] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [currency, setCurrency] = useState('USD')

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

  async function handlePost(e) {
    e.preventDefault()
    setError('')
    if (!form.model) { setError('Model name is required.'); return }
    if (!form.price_usd && !form.price_eur) { setError('At least one price (USD or EUR) is required.'); return }
    setPosting(true)
    try {
      const { data: watch, error: wErr } = await supabase.from('watches').insert({
        brand: form.brand,
        model: form.model,
        reference: form.reference || null,
        condition: form.condition,
        price_usd: form.price_usd ? Number(form.price_usd) : null,
        price_eur: form.price_eur ? Number(form.price_eur) : null,
        notes: form.notes || null,
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
      setMsg('Watch posted — now live in the dealer catalog.')
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
    if (!window.confirm('Delete this watch?')) return
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
        <div className={`tab ${tab === 'post' ? 'active' : ''}`} onClick={() => setTab('post')}>Post new watch</div>
      </div>

      {tab === 'listings' && (
        <div style={{ padding: 16 }}>
          {msg && <div className="success-msg" style={{ marginBottom: 12 }}>{msg}</div>}
          {loading ? <div className="loading-page" style={{ minHeight: 200 }}><div className="spinner" /></div>
            : watches.length === 0 ? <div className="empty-state">No watches posted yet</div>
            : watches.map(w => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid #e8e5e0', borderRadius: 10, marginBottom: 8, background: '#fff' }}>
                <div style={{ width: 50, height: 50, borderRadius: 8, background: '#f7f6f3', border: '1px solid #e8e5e0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {getThumb(w) ? <img src={getThumb(w)} alt={w.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 20 }}>⌚</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{w.brand} {w.model}</div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>{fmtPrice(w)} · {w.condition}{w.reference ? ` · ${w.reference}` : ''}</div>
                </div>
                <span className={`badge badge-${w.status}`}>{w.status}</span>
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
              <input value={form.model} onChange={e => handleField('model', e.target.value)} placeholder="e.g. Daytona, Nautilus, Royal Oak" required />
            </div>

            <div className="form-row">
              <label>Reference number</label>
              <input value={form.reference} onChange={e => handleField('reference', e.target.value)} placeholder="e.g. 116500LN" />
            </div>

            <div className="form-2col">
              <div className="form-row">
                <label>Price USD ($)</label>
                <input type="number" value={form.price_usd} onChange={e => handleField('price_usd', e.target.value)} placeholder="e.g. 38500" />
              </div>
              <div className="form-row">
                <label>Price EUR (€)</label>
                <input type="number" value={form.price_eur} onChange={e => handleField('price_eur', e.target.value)} placeholder="e.g. 35000" />
              </div>
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
