import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useExchangeRate } from '../hooks/useExchangeRate'
import Topbar from '../components/Topbar'

const WHATSAPP_NUMBER = process.env.REACT_APP_WHATSAPP_NUMBER || ''

function cleanRef(ref) {
  if (!ref) return ''
  return ref.split(/[\/\-]/).filter(Boolean).pop()
}
const CATEGORIES = ['Watches', 'Jewellery', 'Bags']

const CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair',
  'Needs Repair',
  'Repaired',
  'Repaired Albania',
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
  const [dragIndex, setDragIndex] = useState(null)

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
        category: data.category || 'Watches',
        brand: data.brand || '',
        model: data.model || '',
        reference: data.reference || '',
        condition: data.condition || 'pre-owned conditions with MINOR signs of usage',
        price_usd: data.price_usd || '',
        price_eur: data.price_eur || '',
        notes: data.notes || '',
        metal_type: data.metal_type || '',
        jewellery_type: data.jewellery_type || '',
        item_size: data.item_size || '',
        scope_of_delivery: data.scope_of_delivery || '',
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
      category: editForm.category || 'Watches',
      brand: editForm.brand,
      model: editForm.model,
      reference: editForm.reference || null,
      condition: editForm.condition,
      price_usd: editForm.price_eur && rate ? Math.round(Number(editForm.price_eur) * rate) : editForm.price_usd ? Number(editForm.price_usd) : null,
      price_eur: editForm.price_eur ? Number(editForm.price_eur) : null,
      notes: editForm.notes || null,
      scope_of_delivery: editForm.scope_of_delivery || null,
      metal_type: editForm.category === 'Jewellery' && editForm.metal_type ? editForm.metal_type : null,
      jewellery_type: editForm.category === 'Jewellery' && editForm.jewellery_type ? editForm.jewellery_type : null,
      item_size: editForm.category === 'Jewellery' && editForm.item_size && editForm.jewellery_type !== 'Necklaces' ? editForm.item_size : null,
    }).eq('id', id)
    if (!error) { await fetchWatch(); setEditing(false); setMsg('Watch updated successfully.') }
    setSaving(false)
  }

  async function handleDeleteListing() {
    if (!window.confirm('Delete this listing permanently? This cannot be undone.')) return
    for (const img of images) {
      const path = img.url.split('/object/public/watch-images/')[1]
      if (path) await supabase.storage.from('watch-images').remove([decodeURIComponent(path)])
    }
    await supabase.from('watch_images').delete().eq('watch_id', id)
    await supabase.from('watches').delete().eq('id', id)
    navigate(-1)
  }

  async function handleReorderImages(fromIndex, toIndex) {
    if (fromIndex === toIndex) return
    const reordered = [...images]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    setImages(reordered)
    setActiveImg(toIndex)
    await Promise.all(reordered.map((img, i) =>
      supabase.from('watch_images').update({ position: i }).eq('url', img.url)
    ))
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
    setUploadingImg(false)
    await fetchWatch()
  }

  function handleShare() {
    const url = window.location.href
    if (navigator.share) {
      navigator.share({ title: `${watch.brand} ${watch.model}`, url })
    } else {
      navigator.clipboard.writeText(url)
      setMsg('Link copied to clipboard.')
    }
  }

  function handleWhatsApp() {
    const price = currency === 'EUR' && watch.price_eur
      ? `€${Number(watch.price_eur).toLocaleString()}`
      : watch.price_usd ? `$${Number(watch.price_usd).toLocaleString()}` : ''
    const text = `Hi, I'm interested in this item from Brandville Vault:\n\n${watch.brand} ${watch.model}${watch.reference ? ` (${watch.reference})` : ''}\n${price}\n\n${window.location.href}`
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, '_blank')
  }

  if (loading) return <div className="loading-page"><div className="spinner" /></div>
  if (!watch) return <div className="page"><div className="empty-state">Item not found</div></div>

  const priceMain = currency === 'EUR' && watch.price_eur
    ? `€${Number(watch.price_eur).toLocaleString()}`
    : watch.price_usd ? `$${Number(watch.price_usd).toLocaleString()}` : '—'

  const priceSecondary = currency === 'EUR' && watch.price_eur && rate
    ? `$${Math.round(Number(watch.price_eur) * rate).toLocaleString()} USD`
    : null

  const canEdit = profile?.role === 'admin' || profile?.role === 'agent'

  return (
    <div className="page">
      <Topbar currency={currency} onCurrencyChange={setCurrency} />

      {/* Back + Edit bar */}
      <div style={{ maxWidth: 940, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px' }}>
        <button className="btn btn-sm" onClick={() => navigate(-1)}>← Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && !editing && <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>}
          {editing && <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>}
          {profile?.role === 'admin' && !editing && <button className="btn btn-sm" onClick={handleDeleteListing} style={{ color: '#c00', borderColor: '#f09595' }}>Delete</button>}
        </div>
      </div>

      {msg && <div className="success-msg" style={{ maxWidth: 940, margin: '0 auto 4px', padding: '0 20px' }}><div>{msg}</div></div>}

      {/* 2-column layout */}
      <div className="detail-layout">

        {/* LEFT — images */}
        <div className="detail-left">
          <div style={{ position: 'relative', background: '#f8f6f2', borderRadius: 16, overflow: 'hidden', aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #eeebe5' }}>
            {images.length > 0 ? (
              <>
                <img
                  src={images[activeImg]?.url}
                  alt={watch.model}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'zoom-in' }}
                  onClick={() => setLightbox(activeImg)}
                />
                {images.length > 1 && (
                  <div style={{ position: 'absolute', bottom: 12, display: 'flex', gap: 6 }}>
                    {images.map((_, i) => (
                      <div key={i} onClick={() => setActiveImg(i)} style={{ width: 7, height: 7, borderRadius: '50%', background: i === activeImg ? '#b8965a' : 'rgba(0,0,0,0.18)', cursor: 'pointer', transition: 'background 0.15s' }} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <span style={{ fontSize: 48 }}>⌚</span>
            )}
          </div>

          {/* Thumbnails */}
          {images.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {images.map((img, i) => (
                <div
                  key={img.url}
                  draggable={editing}
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => { handleReorderImages(dragIndex, i); setDragIndex(null) }}
                  onDragEnd={() => setDragIndex(null)}
                  style={{ position: 'relative', flexShrink: 0, opacity: dragIndex === i ? 0.4 : 1, cursor: editing ? 'grab' : 'pointer' }}
                >
                  <img
                    src={img.url}
                    alt=""
                    onClick={() => !editing && setActiveImg(i)}
                    style={{ width: 58, height: 58, objectFit: 'cover', borderRadius: 10, border: i === activeImg ? '2px solid #b8965a' : '2px solid #eeebe5', pointerEvents: editing ? 'none' : 'auto', transition: 'border-color 0.15s' }}
                  />
                  {editing && (
                    <button onClick={() => handleDeleteImage(img)} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: '#e00', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                  )}
                </div>
              ))}
              {editing && (
                <label style={{ width: 58, height: 58, borderRadius: 10, border: '2px dashed #b8965a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 22, color: '#b8965a', background: '#faf3e5' }}>
                  {uploadingImg ? <span className="spinner" style={{ width: 16, height: 16 }} /> : '+'}
                  <input type="file" accept="image/*" multiple onChange={handleAddImages} style={{ display: 'none' }} />
                </label>
              )}
            </div>
          )}
          {editing && images.length === 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', color: '#8a8078', fontSize: 13 }}>
              {uploadingImg ? <span className="spinner" style={{ width: 16, height: 16 }} /> : '+ Add photos'}
              <input type="file" accept="image/*" multiple onChange={handleAddImages} style={{ display: 'none' }} />
            </label>
          )}
        </div>

        {/* RIGHT — info */}
        <div className="detail-right">
          {editing ? (
            <div style={{ background: '#f8f6f2', borderRadius: 12, padding: 16, marginBottom: 20, border: '1px solid #eeebe5' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8a8078', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 14 }}>Edit details</div>
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
                    {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              {editForm.category === 'Jewellery' && (
                <>
                  <div className="form-row"><label>Jewellery type</label>
                    <select value={editForm.jewellery_type || ''} onChange={e => setEditForm(f => ({ ...f, jewellery_type: e.target.value, item_size: '' }))}>
                      <option value="">Select type</option>
                      <option>Rings</option><option>Bracelets</option><option>Necklaces</option><option>Earrings</option>
                    </select>
                  </div>
                  <div className="form-row"><label>Metal type</label>
                    <select value={editForm.metal_type || ''} onChange={e => setEditForm(f => ({ ...f, metal_type: e.target.value }))}>
                      <option value="">Select metal</option>
                      <option>Yellow Gold</option><option>Pink Gold</option><option>White Gold</option><option>Platinum</option>
                    </select>
                  </div>
                  {editForm.jewellery_type === 'Rings' && (
                    <div className="form-row"><label>Ring size</label>
                      <select value={editForm.item_size || ''} onChange={e => setEditForm(f => ({ ...f, item_size: e.target.value }))}>
                        <option value="">Select size</option>
                        {['50','51','52','53','54','55','56','57','58','59','60','61','62','63','64','65'].map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  {editForm.jewellery_type === 'Bracelets' && (
                    <div className="form-row"><label>Bracelet size</label>
                      <select value={editForm.item_size || ''} onChange={e => setEditForm(f => ({ ...f, item_size: e.target.value }))}>
                        <option value="">Select size</option>
                        {['14','15','16','17','18','19','20','21','22','23','XS','S','M','L','XL','XXL','3XL'].map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}
              <div className="form-row"><label>Model</label><input value={editForm.model} onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))} /></div>
              <div className="form-row"><label>Reference</label><input value={editForm.reference} onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))} /></div>
              <div className="form-row"><label>Scope of Delivery</label>
                <select value={editForm.scope_of_delivery || ''} onChange={e => setEditForm(f => ({ ...f, scope_of_delivery: e.target.value }))}>
                  <option value="">—</option>
                  <option>Watch Only</option><option>With Card</option><option>With Box</option><option>Card & Box</option>
                </select>
              </div>
              <div className="form-2col">
                <div className="form-row"><label>Price USD</label><input type="number" value={editForm.price_usd} onChange={e => setEditForm(f => ({ ...f, price_usd: e.target.value }))} placeholder="Auto from EUR" /></div>
                <div className="form-row"><label>Price EUR</label><input type="number" value={editForm.price_eur} onChange={e => setEditForm(f => ({ ...f, price_eur: e.target.value }))} /></div>
              </div>
              <div className="form-row"><label>Notes</label><textarea rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <button className="btn btn-dark btn-full" onClick={handleSaveEdit} disabled={saving}>{saving ? '...' : 'Save changes'}</button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#b8b0a5', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 4 }}>{watch.category || 'Watches'}</div>
                  <div className="detail-brand">{watch.brand}</div>
                  <div className="detail-model">{watch.model}</div>
                  <div className="detail-ref">{cleanRef(watch.reference) || '—'}</div>
                </div>
                <span className={`badge badge-${watch.status}`} style={{ flexShrink: 0, marginTop: 4 }}>{watch.status}</span>
              </div>

              <div className="detail-price">{priceMain}</div>
              {priceSecondary && <div className="detail-price-secondary">≈ {priceSecondary}</div>}

              <div className="detail-meta">
                <div className="detail-meta-row"><span>Condition</span><span>{watch.condition}</span></div>
                {watch.scope_of_delivery && <div className="detail-meta-row"><span>Scope of delivery</span><span>{watch.scope_of_delivery}</span></div>}
                {watch.jewellery_type && <div className="detail-meta-row"><span>Type</span><span>{watch.jewellery_type}</span></div>}
                {watch.metal_type && <div className="detail-meta-row"><span>Metal</span><span>{watch.metal_type}</span></div>}
                {watch.item_size && <div className="detail-meta-row"><span>Size</span><span>{watch.item_size}</span></div>}
                {watch.notes && <div className="detail-meta-row"><span>Notes</span><span>{watch.notes}</span></div>}
                <div className="detail-meta-row"><span>Agent</span><span>{watch.profiles?.full_name || '—'}</span></div>
                <div className="detail-meta-row"><span>Posted</span><span>{new Date(watch.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
              </div>

              <div className="detail-actions">
                <button className="btn btn-green" onClick={handleWhatsApp}>WhatsApp</button>
                {watch.status === 'available'
                  ? <button className="btn btn-warning" onClick={handleReserve} disabled={reserving}>{reserving ? '...' : 'Reserve'}</button>
                  : (watch.reserved_by === profile?.id || profile?.role === 'admin')
                    ? <button className="btn" onClick={handleUnreserve} disabled={reserving}>{reserving ? '...' : 'Unreserve'}</button>
                    : null
                }
                <button className="btn" onClick={handleShare}>Share</button>
              </div>
            </>
          )}
        </div>

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
            <div style={{ position: 'absolute', bottom: 24, display: 'flex', gap: 7 }}>
              {images.map((_, i) => (
                <div key={i} onClick={e => { e.stopPropagation(); setLightbox(i) }} style={{ width: 8, height: 8, borderRadius: '50%', background: i === lightbox ? '#b8965a' : 'rgba(255,255,255,0.35)', cursor: 'pointer', transition: 'background 0.15s' }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
