import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useExchangeRate } from '../hooks/useExchangeRate'
import Topbar from '../components/Topbar'

const WHATSAPP_NUMBER = process.env.REACT_APP_WHATSAPP_NUMBER || ''
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

export default function WatchDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { rate } = useExchangeRate()
  const [watch, setWatch] = useState(null)
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState('EUR')
  const [reserving, setReserving] = useState(false)
  const [msg, setMsg] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [activeImg, setActiveImg] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)

  const fetchWatch = useCallback(async () => {
    const { data } = await supabase
      .from('watches')
      .select('*, watch_images(url, position), profiles!posted_by(full_name)')
      .eq('id', id)
      .single()
    if (data) {
      setWatch(data)
      setImages([...(data.watch_images || [])].sort((a, b) => a.position - b.position))
      setEditForm({
        brand: data.brand, model: data.model, reference: data.reference || '',
        condition: data.condition, price_usd: data.price_usd || '',
        price_eur: data.price_eur || '', notes: data.notes || ''
      })
    }
    setLoading(false)
  }, [id])

  useEffect(() => { fetchWatch() }, [fetchWatch])

  useEffect(() => {
    function onKey(e) {
      if (lightbox === null) return
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox(i => Math.min(i + 1, images.length - 1))
      if (e.key === 'ArrowLeft') setLightbox(i => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, images.length])

  async function handleReserve() {
    setReserving(true)
    const { error } = await supabase.from('watches').update({ status: 'reserved', reserved_by: profile.id }).eq('id', id)
    if (!error) { setWatch(w => ({ ...w, status: 'reserved' })); setMsg('Watch reserved successfully.') }
    setReserving(false)
  }

  async function handleUnreserve() {
    setReserving(true)
    const { error } = await supabase.from('watches').update({ status: 'available', reserved_by: null }).eq('id', id)
    if (!error) { setWatch(w => ({ ...w, status: 'available' })); setMsg('Watch is available again.') }
    setReserving(false)
  }

  async function handleSaveEdit() {
    setSaving(true)
    const { error } = await supabase.from('watches').update({
      category: editForm.category || "Watches", brand: editForm.brand, model: editForm.model,
      reference: editForm.reference || null, condition: editForm.condition,
      price_usd: editForm.price_eur && rate ? Math.round(Number(editForm.price_eur) * rate) : editForm.price_usd ? Number(editForm.price_usd) : null,
      price_eur: editForm.price_eur ? Number(editForm.price_eur) : null,
      notes: editForm.notes || null,
    }).eq('id', id)
    if (!error) { await fetchWatch(); setEditing(false); setMsg('Watch updated successfully.') }
    setSaving(false)
  }

  async function handleDeleteImage(img) {
    const path = img.url.split('/object/public/watch-images/')[1]
    if (path) await supabase.storage.from('watch-images').remove([decodeURIComponent(path)])
    await supabase.from('watch_images').delete().eq('url', img.url)
    setActiveImg(0)
    await fetchWatch()
  }

  async function handleAddImages(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploadingImg(true)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.split('.').pop()
      const path = `${id}/${Date.now()}_${i}.${ext}`
      const { error: upErr } = await supabase.storage.from('watch-images').upload(path, file)
      if (upErr) continue
      const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path)
      await supabase.from('watch_images').insert({ watch_id: id, url: publicUrl, position: images.length + i })
    }
    await fetchWatch()
    setUploadingImg(false)
  }

  function fmtSharePrice(w) {
    if (currency === 'EUR' && w.price_eur) return '€' + Number(w.price_eur).toLocaleString() + ' EUR'
    if (w.price_usd) return '$' + Number(w.price_usd).toLocaleString() + ' USD'
    return ''
  }

  function buildMsg(watch, price, link) {
    const modelLine = watch.model.toLowerCase().startsWith(watch.brand.toLowerCase())
      ? watch.model
      : watch.brand + ' ' + watch.model
    return '*' + modelLine + '*' +
      '\nRef: ' + (watch.reference || '—') +
      '\nCondition: ' + watch.condition +
      '\nPrice: ' + price +
      (watch.notes ? '\nNotes: ' + watch.notes : '') +
      '\n\n' + link
  }

  function handleWhatsApp() {
    const price = fmtSharePrice(watch)
    const link = 'https://project-20gho.vercel.app/catalog/' + id
    window.open('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(buildMsg(watch, price, link)), '_blank')
  }

  function handleShare() {
    const price = fmtSharePrice(watch)
    const link = 'https://project-20gho.vercel.app/catalog/' + id
    const text = buildMsg(watch, price, link)
    if (navigator.share) {
      navigator.share({ title: watch.model, text: text, url: link })
    } else {
      navigator.clipboard.writeText(text)
      setMsg('Link and details copied to clipboard.')
    }
  }

  if (loading) return <div className="loading-page"><div className="spinner" /></div>
  if (!watch) return <div className="loading-page">Watch not found.</div>

  const priceMain = currency === 'EUR' && watch.price_eur ? `€${Number(watch.price_eur).toLocaleString()}` : watch.price_usd ? `$${Number(watch.price_usd).toLocaleString()}` : '—'
  const priceSecondary = currency === 'EUR' && watch.price_usd ? `$${Number(watch.price_usd).toLocaleString()} USD` : currency === 'USD' && watch.price_eur ? `€${Number(watch.price_eur).toLocaleString()} EUR` : null
  const canEdit = profile?.role === 'admin' || profile?.role === 'agent'

  return (
    <div className="page">
      <Topbar currency={currency} onCurrencyChange={setCurrency} />
      <div className="detail-page">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="back-btn" style={{ margin: 0 }} onClick={() => navigate(-1)}>← Back</div>
          {canEdit && !editing && (
            <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
          )}
          {editing && (
            <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          )}
        </div>

        {msg && <div className="success-msg">{msg}</div>}

        {/* Images */}
        {images.length > 0 ? (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{ width: '100%', height: 340, borderRadius: 12, overflow: 'hidden', border: '1px solid #e8e5e0', cursor: editing ? 'default' : 'zoom-in', marginBottom: 8, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
              onClick={() => !editing && setLightbox(activeImg)}
            >
              <img src={images[activeImg]?.url} alt={watch.model} style={{ maxWidth: '100%', maxHeight: '340px', objectFit: 'contain' }} />
              {editing && (
                <button
                  onClick={() => handleDeleteImage(images[activeImg])}
                  style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(180,0,0,0.8)', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                >Remove photo</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {images.map((img, i) => (
                <div key={i} onClick={() => setActiveImg(i)} style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 8, overflow: 'hidden', border: `2px solid ${i === activeImg ? '#1a1a1a' : '#e8e5e0'}`, cursor: 'pointer' }}>
                  <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
              {editing && (
                <label style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 8, border: '2px dashed #d0cdc8', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 24, color: '#aaa' }}>
                  {uploadingImg ? <span className="spinner" style={{ width: 16, height: 16 }} /> : '+'}
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleAddImages} />
                </label>
              )}
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', height: 280, borderRadius: 12, border: '1px solid #e8e5e0', background: '#f7f6f3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80, marginBottom: 20, flexDirection: 'column', gap: 12 }}>
            <span>⌚</span>
            {editing && (
              <label style={{ fontSize: 13, color: '#888', border: '1px solid #e0ddd8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
                Add photos
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleAddImages} />
              </label>
            )}
          </div>
        )}

        {/* Edit form */}
        {editing ? (
          <div style={{ background: '#f7f6f3', borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Edit details</div>
            <div className="form-row"><label>Category</label>
              <select value={editForm.category || 'Watches'} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-2col">
              <div className="form-row"><label>Brand</label>
                <select value={editForm.brand} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))}>
                  {BRANDS.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-row"><label>Condition</label>
                <select value={editForm.condition} onChange={e => setEditForm(f => ({ ...f, condition: e.target.value }))}>
                  <option>Unworn</option><option>Excellent</option><option>Good</option>
                </select>
              </div>
            </div>
            <div className="form-row"><label>Model</label><input value={editForm.model} onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))} /></div>
            <div className="form-row"><label>Reference</label><input value={editForm.reference} onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))} /></div>
            <div className="form-2col">
              <div className="form-row"><label>Price USD</label><input type="number" value={editForm.price_usd} onChange={e => setEditForm(f => ({ ...f, price_usd: e.target.value }))} placeholder="Auto-calculated from EUR" /></div>
              <div className="form-row"><label>Price EUR</label><input type="number" value={editForm.price_eur} onChange={e => setEditForm(f => ({ ...f, price_eur: e.target.value }))} /></div>
            </div>
            <div className="form-row"><label>Notes</label><textarea rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <button className="btn btn-dark btn-full" onClick={handleSaveEdit} disabled={saving}>{saving ? '...' : 'Save changes'}</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{fontSize:10,color:'#aaa',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:2}}>{watch.category || 'Watches'}</div>
                <div className="detail-brand">{watch.brand}</div>
                <div className="detail-model">{watch.model}</div>
                <div className="detail-ref">{watch.reference || '—'}</div>
              </div>
              <span className={`badge badge-${watch.status}`} style={{ fontSize: 13, padding: '4px 10px' }}>{watch.status}</span>
            </div>

            <div className="detail-price">{priceMain}</div>
            {priceSecondary && <div className="detail-price-secondary">≈ {priceSecondary}</div>}

            <div className="detail-meta">
              <div className="detail-meta-row"><span>Condition</span><span>{watch.condition}</span></div>
              {watch.notes && <div className="detail-meta-row"><span>Notes</span><span>{watch.notes}</span></div>}
              <div className="detail-meta-row"><span>Agent</span><span>{watch.profiles?.full_name || '—'}</span></div>
              <div className="detail-meta-row"><span>Posted</span><span>{new Date(watch.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
            </div>

            <div className="detail-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-green" onClick={handleWhatsApp} style={{ flex: 1 }}>WhatsApp</button>
              {watch.status === 'available'
                ? <button className="btn btn-warning" onClick={handleReserve} disabled={reserving} style={{ flex: 1 }}>{reserving ? '...' : 'Reserve'}</button>
                : (watch.reserved_by === profile?.id || profile?.role === 'admin')
                  ? <button className="btn" onClick={handleUnreserve} disabled={reserving} style={{ flex: 1 }}>{reserving ? '...' : 'Unreserve'}</button>
                  : null
              }
              <button className="btn" onClick={handleShare} style={{ flex: 1 }}>Share</button>
            </div>
          </>
        )}
      </div>

      {/* Lightbox */}
      {lightbox !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.93)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 20, right: 24, background: 'none', border: 'none', color: '#fff', fontSize: 36, cursor: 'pointer', lineHeight: 1 }}>×</button>
          {images.length > 1 && lightbox > 0 && (
            <button onClick={e => { e.stopPropagation(); setLightbox(i => i - 1) }} style={{ position: 'absolute', left: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 28, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer' }}>‹</button>
          )}
          <img src={images[lightbox].url} alt={watch.model} style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
          {images.length > 1 && lightbox < images.length - 1 && (
            <button onClick={e => { e.stopPropagation(); setLightbox(i => i + 1) }} style={{ position: 'absolute', right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 28, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer' }}>›</button>
          )}
          {images.length > 1 && (
            <div style={{ position: 'absolute', bottom: 20, display: 'flex', gap: 6 }}>
              {images.map((_, i) => (
                <div key={i} onClick={e => { e.stopPropagation(); setLightbox(i) }} style={{ width: 8, height: 8, borderRadius: '50%', background: i === lightbox ? '#fff' : 'rgba(255,255,255,0.35)', cursor: 'pointer' }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
