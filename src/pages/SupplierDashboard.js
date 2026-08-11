import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

const BRANDS = [
  'A. Lange & Söhne', 'Audemars Piguet', 'Blancpain', 'Breguet', 'Breitling',
  'Bulgari', 'Cartier', 'Chopard', 'Girard-Perregaux', 'Grand Seiko',
  'Harry Winston', 'Hermès', 'Hublot', 'IWC', 'Jaeger-LeCoultre', 'Omega',
  'Other', 'Panerai', 'Patek Philippe', 'Piaget', 'Richard Mille', 'Rolex',
  'TAG Heuer', 'Tudor', 'Ulysse Nardin', 'Vacheron Constantin', 'Zenith',
]

const CONDITIONS = [
  'Pre-owned',
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair', 'Needs Repair',
]

const SCOPES = ['Watch Only', 'With Card', 'With Box', 'Card & Box']

const EMPTY_FORM = {
  brand: '', model: '', reference: '',
  condition: 'Pre-owned', scope_of_delivery: '',
  asking_price: '', asking_price_currency: 'CNY', notes: '',
}

const PRICE_CURRENCIES = [
  { value: 'CNY', label: '¥ CNY' },
  { value: 'HKD', label: 'HK$ HKD' },
  { value: 'EUR', label: '€ EUR' },
  { value: 'USD', label: '$ USD' },
]

const STATUS_CONFIG = {
  draft:          { label: 'Draft',          color: '#94a3b8' },
  pending_review: { label: 'Pending Review', color: '#f59e0b' },
  approved:       { label: 'Approved',       color: '#22c55e' },
  rejected:       { label: 'Rejected',       color: '#ef4444' },
}

async function notifyAgents(listing, supplierName) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({
        action: 'supplier_submitted',
        supplier_name: supplierName,
        brand: listing.brand,
        model: listing.model,
        reference: listing.reference,
        asking_price: listing.asking_price,
      }),
    })
  } catch (e) { console.log('Notify error:', e) }
}

const fieldLabel = { color: 'var(--faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }
const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 0 }

export default function SupplierDashboard() {
  const { user, profile } = useAuth()
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list' | 'new' | 'edit' | 'detail'
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [newImages, setNewImages] = useState([])
  const [newPreviews, setNewPreviews] = useState([])
  const [existingImgs, setExistingImgs] = useState([])
  const [removedImgIds, setRemovedImgIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { fetchListings() }, [])

  async function fetchListings() {
    setLoading(true)
    const { data } = await supabase
      .from('supplier_listings')
      .select('*, supplier_listing_images(id, url, position)')
      .eq('supplier_id', user.id)
      .order('created_at', { ascending: false })
    setListings(data || [])
    setLoading(false)
  }

  function handleNewImages(e) {
    const files = Array.from(e.target.files)
    setNewImages(prev => [...prev, ...files])
    setNewPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))])
  }

  function removeNewImage(idx) {
    setNewImages(prev => prev.filter((_, i) => i !== idx))
    setNewPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  function removeExistingImage(id) {
    setRemovedImgIds(prev => [...prev, id])
    setExistingImgs(prev => prev.filter(img => img.id !== id))
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setNewImages([])
    setNewPreviews([])
    setExistingImgs([])
    setRemovedImgIds([])
    setError('')
  }

  function enterEdit(listing) {
    setSelected(listing)
    setForm({
      brand: listing.brand || '',
      model: listing.model || '',
      reference: listing.reference || '',
      condition: listing.condition || 'Pre-owned',
      scope_of_delivery: listing.scope_of_delivery || '',
      asking_price: listing.asking_price || '',
      notes: listing.notes || '',
    })
    const imgs = (listing.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    setExistingImgs(imgs)
    setRemovedImgIds([])
    setNewImages([])
    setNewPreviews([])
    setError('')
    setView('edit')
  }

  async function handleCreate(submitForReview = false) {
    if (!form.brand) { setError('Brand is required.'); return }
    if (!form.model) { setError('Model is required.'); return }
    if (submitForReview && newImages.length === 0) {
      setError('At least one photo is required to submit for review.'); return
    }

    submitForReview ? setSubmitting(true) : setSaving(true)
    setError('')

    try {
      const { data: listing, error: lErr } = await supabase
        .from('supplier_listings')
        .insert({
          brand: form.brand,
          model: form.model,
          reference: form.reference || null,
          condition: form.condition || null,
          scope_of_delivery: form.scope_of_delivery || null,
          notes: form.notes || null,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
          asking_price_currency: form.asking_price_currency || 'CNY',
          supplier_id: user.id,
          status: submitForReview ? 'pending_review' : 'draft',
        })
        .select()
        .single()
      if (lErr) throw lErr

      await uploadImages(listing.id, newImages, 0)
      if (submitForReview) await notifyAgents(listing, profile?.full_name || 'A supplier')

      setMsg(submitForReview ? 'Listing submitted for review. An agent will be in touch.' : 'Draft saved.')
      resetForm()
      setView('list')
      fetchListings()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
      setSubmitting(false)
    }
  }

  async function handleEdit(submitForReview = false) {
    if (!form.brand) { setError('Brand is required.'); return }
    if (!form.model) { setError('Model is required.'); return }
    const totalImages = existingImgs.length + newImages.length
    if (submitForReview && totalImages === 0) {
      setError('At least one photo is required to submit for review.'); return
    }

    submitForReview ? setSubmitting(true) : setSaving(true)
    setError('')

    try {
      const newStatus = submitForReview ? 'pending_review' : selected.status
      const { error: uErr } = await supabase
        .from('supplier_listings')
        .update({
          brand: form.brand,
          model: form.model,
          reference: form.reference || null,
          condition: form.condition || null,
          scope_of_delivery: form.scope_of_delivery || null,
          notes: form.notes || null,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
          asking_price_currency: form.asking_price_currency || 'CNY',
          status: newStatus,
        })
        .eq('id', selected.id)
      if (uErr) throw uErr

      for (const id of removedImgIds) {
        await supabase.from('supplier_listing_images').delete().eq('id', id)
      }

      await uploadImages(selected.id, newImages, existingImgs.length)

      if (submitForReview && selected.status !== 'pending_review') {
        await notifyAgents({ ...selected, ...form }, profile?.full_name || 'A supplier')
      }

      setMsg(submitForReview ? 'Listing submitted for review.' : 'Changes saved.')
      resetForm()
      setView('list')
      fetchListings()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
      setSubmitting(false)
    }
  }

  async function uploadImages(listingId, files, startPos) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.split('.').pop()
      const path = `supplier_listings/${listingId}/${Date.now()}_${i}.${ext}`
      const { error: upErr } = await supabase.storage.from('watch-images').upload(path, file)
      if (upErr) continue
      const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path)
      await supabase.from('supplier_listing_images').insert({ listing_id: listingId, url: publicUrl, position: startPos + i })
    }
  }

  async function submitDraft(listing) {
    if (!window.confirm('Submit this listing for agent review?')) return
    const { error } = await supabase
      .from('supplier_listings')
      .update({ status: 'pending_review' })
      .eq('id', listing.id)
    if (error) { alert('Error: ' + error.message); return }
    await notifyAgents(listing, profile?.full_name || 'A supplier')
    fetchListings()
    setSelected(prev => prev?.id === listing.id ? { ...prev, status: 'pending_review' } : prev)
  }

  function getCover(listing) {
    const imgs = (listing.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    return imgs[0]?.url || null
  }

  const [filterStatus, setFilterStatus] = useState('all')
  const [lightboxIdx, setLightboxIdx] = useState(null)
  const [lightboxImgs, setLightboxImgs] = useState([])
  const [supSearch, setSupSearch] = useState('')

  const lightboxUrl = lightboxIdx !== null ? lightboxImgs[lightboxIdx] : null
  const openLightbox = (imgs, idx) => { setLightboxImgs(imgs); setLightboxIdx(idx) }
  const closeLightbox = () => { setLightboxIdx(null); setLightboxImgs([]) }
  const lightboxPrev = e => { if (e) e.stopPropagation(); setLightboxIdx(i => (i - 1 + lightboxImgs.length) % lightboxImgs.length) }
  const lightboxNext = e => { if (e) e.stopPropagation(); setLightboxIdx(i => (i + 1) % lightboxImgs.length) }

  useEffect(() => {
    if (lightboxIdx === null) return
    const handler = e => {
      if (e.key === 'ArrowRight') lightboxNext()
      else if (e.key === 'ArrowLeft') lightboxPrev()
      else if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightboxIdx, lightboxImgs])

  const statusCfg = s => STATUS_CONFIG[s] || STATUS_CONFIG.draft
  const canEdit = s => s === 'draft' || s === 'rejected' || s === 'pending_review'

  const fmtDate = d => {
    const dt = new Date(d)
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
  }

  const filteredListings = listings.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    if (supSearch) {
      const q = supSearch.toLowerCase()
      if (!`${l.brand} ${l.model} ${l.reference || ''}`.toLowerCase().includes(q)) return false
    }
    return true
  })

  const IconBagSB = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
  const IconCheck = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
  const IconX = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>

  const sbNav = (filter, label, icon) => {
    const isActive = filter === 'all'
      ? (view === 'list' && filterStatus === 'all') || view === 'detail' || view === 'new' || view === 'edit'
      : view === 'list' && filterStatus === filter
    return (
      <button onClick={() => { setFilterStatus(filter); setView('list'); setSelected(null) }} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 16px',
        borderTop: 'none', borderRight: 'none', borderBottom: 'none',
        borderLeft: isActive ? '2px solid #b8965a' : '2px solid transparent',
        cursor: 'pointer', textAlign: 'left',
        background: isActive ? '#faf6f0' : 'transparent',
        color: isActive ? '#b8965a' : '#374151',
        fontWeight: isActive ? 600 : 400, fontSize: 14,
        transition: 'background 0.12s, color 0.12s',
      }}>
        <span style={{ color: isActive ? '#b8965a' : '#6b7280', display: 'flex', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
      </button>
    )
  }

  const sidebarEl = (
    <aside style={{ width: 230, flexShrink: 0, borderRight: '1px solid #e5e7eb', background: '#fff', display: 'flex', flexDirection: 'column', padding: '20px 0 16px', overflowY: 'auto' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9ca3af', padding: '0 16px', marginBottom: 6 }}>Listings</div>
      {sbNav('all', 'My Listings', <IconBagSB />)}
      {sbNav('approved', 'Approved', <IconCheck />)}
      {sbNav('rejected', 'Rejected', <IconX />)}
      <div style={{ flex: 1 }} />
      <div style={{ margin: '16px 12px 0', background: '#fdf8f2', border: '1px solid #e9d8bc', borderRadius: 12, padding: '14px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: 50, background: '#f5ede0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" fill="none" stroke="#b8965a" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Need help?</span>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, lineHeight: 1.5 }}>Our team is here to help you.</div>
        <button style={{ width: '100%', fontSize: 13, padding: '8px 0', border: '1px solid #c8a76a', borderRadius: 8, background: 'transparent', color: '#b8965a', cursor: 'pointer', fontWeight: 500 }}>Contact Support →</button>
      </div>
    </aside>
  )

  const lightboxEl = lightboxIdx !== null && (
    <div
      onClick={closeLightbox}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, cursor: 'zoom-out' }}
    >
      <img src={lightboxUrl} alt="" style={{ maxWidth: '82vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 10, userSelect: 'none' }} />

      {lightboxImgs.length > 1 && (
        <button onClick={lightboxPrev} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 44, height: 44, fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
      )}
      {lightboxImgs.length > 1 && (
        <button onClick={lightboxNext} style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 44, height: 44, fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
      )}

      <button onClick={closeLightbox} style={{ position: 'absolute', top: 18, right: 22, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 38, height: 38, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

      {lightboxImgs.length > 1 && (
        <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
          {lightboxIdx + 1} / {lightboxImgs.length}
        </div>
      )}
    </div>
  )

  if (view === 'new' || view === 'edit') {
    const isEdit = view === 'edit'
    const isDraft = !isEdit || selected?.status === 'draft' || selected?.status === 'rejected'

    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Topbar />
        {lightboxEl}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {sidebarEl}
          <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
            <div style={{ maxWidth: 520 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
                <button className="btn" onClick={() => { resetForm(); setView('list') }} style={{ fontSize: 13 }}>← Back</button>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                  {isEdit ? `Edit — ${selected.brand} ${selected.model}` : 'New Listing'}
                </h2>
              </div>

              {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={fieldWrap}>
                  <div style={fieldLabel}>Brand *</div>
                  <select className="input" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}>
                    <option value="">Select brand</option>
                    {BRANDS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>Model *</div>
                  <input className="input" placeholder="e.g. Submariner Date" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>Reference</div>
                  <input className="input" placeholder="e.g. 126610LN" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={fieldWrap}>
                    <div style={fieldLabel}>Condition</div>
                    <select className="input" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                      {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={fieldWrap}>
                    <div style={fieldLabel}>Scope</div>
                    <select className="input" value={form.scope_of_delivery} onChange={e => setForm(f => ({ ...f, scope_of_delivery: e.target.value }))}>
                      <option value="">Select</option>
                      {SCOPES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>Asking price</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className="input" value={form.asking_price_currency} onChange={e => setForm(f => ({ ...f, asking_price_currency: e.target.value }))} style={{ width: 110, flexShrink: 0 }}>
                      {PRICE_CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <input className="input" placeholder="Optional" type="number" value={form.asking_price} onChange={e => setForm(f => ({ ...f, asking_price: e.target.value }))} style={{ flex: 1 }} />
                  </div>
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>Notes</div>
                  <textarea className="input" placeholder="Any relevant details about the item..." rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>Photos</div>

                  {existingImgs.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {existingImgs.map(img => (
                        <div key={img.id} style={{ position: 'relative' }}>
                          <img src={img.url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-light)' }} />
                          <button onClick={() => removeExistingImage(img.id)} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {newPreviews.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {newPreviews.map((src, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          <img src={src} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px dashed var(--border-light)', opacity: 0.9 }} />
                          <button onClick={() => removeNewImage(i)} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <label className="btn btn-full" style={{ cursor: 'pointer', textAlign: 'center' }}>
                    + Add Photos
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleNewImages} />
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
                  <button className="btn btn-full" onClick={() => isEdit ? handleEdit(false) : handleCreate(false)} disabled={saving || submitting}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  {isDraft && (
                    <button className="btn btn-dark btn-full" onClick={() => isEdit ? handleEdit(true) : handleCreate(true)} disabled={saving || submitting}>
                      {submitting ? 'Submitting…' : 'Submit for Review'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  if (view === 'detail' && selected) {
    const imgs = (selected.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    const cfg = statusCfg(selected.status)
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Topbar />
        {lightboxEl}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {sidebarEl}
          <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
            <div style={{ maxWidth: 680 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
                <button className="btn" onClick={() => { setView('list'); setSelected(null) }} style={{ fontSize: 13 }}>← Back</button>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>{selected.brand} {selected.model}</h2>
                <div style={{ padding: '4px 12px', borderRadius: 20, background: cfg.color + '20', color: cfg.color, fontSize: 12, fontWeight: 600 }}>{cfg.label}</div>
              </div>

              {selected.status === 'rejected' && selected.rejection_reason && (
                <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13, color: '#ef4444' }}>
                  <strong>Rejection reason:</strong> {selected.rejection_reason}
                </div>
              )}

              {imgs.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
                    {imgs.map((img, i) => (
                      <img
                        key={i}
                        src={img.url}
                        alt=""
                        onClick={() => openLightbox(imgs.map(x => x.url), i)}
                        style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid #e5e7eb', cursor: 'zoom-in', flexShrink: 0, transition: 'opacity 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                      />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    {imgs.length > 1 ? `${imgs.length} photos · click to enlarge` : 'Click to enlarge'}
                  </div>
                </div>
              )}

              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                {[
                  selected.reference && ['Reference', selected.reference],
                  selected.condition && ['Condition', selected.condition],
                  selected.scope_of_delivery && ['Scope', selected.scope_of_delivery],
                  selected.asking_price && ['Asking price', `${PRICE_CURRENCIES.find(c => c.value === (selected.asking_price_currency || 'CNY'))?.label?.split(' ')[0] || ''}${Number(selected.asking_price).toLocaleString()}`],
                  selected.created_at && ['Submitted on', fmtDate(selected.created_at)],
                ].filter(Boolean).map(([label, value], i, arr) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: i < arr.length - 1 ? '1px solid #f3f4f6' : 'none', fontSize: 14 }}>
                    <span style={{ color: '#6b7280' }}>{label}</span>
                    <span style={{ fontWeight: label === 'Asking price' ? 600 : 400 }}>{value}</span>
                  </div>
                ))}
              </div>

              {selected.notes && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Notes</div>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
                    {selected.notes}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                {canEdit(selected.status) && (
                  <button className="btn btn-dark" onClick={() => enterEdit(selected)}>Edit Listing</button>
                )}
                {selected.status === 'draft' && (
                  <button className="btn" onClick={() => submitDraft(selected)}>Submit for Review</button>
                )}
                {selected.status === 'rejected' && (
                  <button className="btn" onClick={() => submitDraft(selected)}>Resubmit for Review</button>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  const countByStatus = s => listings.filter(l => l.status === s).length
  const TABS = [
    { key: 'all', label: 'All', count: listings.length },
    { key: 'pending_review', label: 'Pending Review', count: countByStatus('pending_review') },
    { key: 'approved', label: 'Approved', count: countByStatus('approved') },
    { key: 'rejected', label: 'Rejected', count: countByStatus('rejected') },
  ].filter(t => t.key === 'all' || t.count > 0)

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Topbar />
      {lightboxEl}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {sidebarEl}
        <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
          <div style={{ maxWidth: 700 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>My Listings</h2>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{listings.length} item{listings.length !== 1 ? 's' : ''}</div>
              </div>
              <button className="btn btn-dark" onClick={() => { resetForm(); setView('new') }} style={{ flexShrink: 0 }}>+ New Listing</button>
            </div>

            {msg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '11px 16px', marginBottom: 20, fontSize: 14, color: '#15803d' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                {msg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
              {TABS.map(t => {
                const active = filterStatus === t.key
                return (
                  <button key={t.key} onClick={() => setFilterStatus(t.key)} style={{
                    padding: '6px 16px', borderRadius: 20, border: '1px solid #e5e7eb',
                    background: active ? '#1f2937' : '#fff',
                    color: active ? '#fff' : '#374151',
                    fontSize: 13, fontWeight: active ? 600 : 400,
                    cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
                  }}>
                    {t.label} {t.count}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  value={supSearch}
                  onChange={e => setSupSearch(e.target.value)}
                  placeholder="Search listings…"
                  style={{ width: '100%', padding: '8px 12px 8px 36px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
            ) : filteredListings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 24px', color: '#9ca3af', fontSize: 14 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151', fontSize: 15 }}>No listings yet</div>
                <div>Submit your first item to get started.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredListings.map(listing => {
                  const cover = getCover(listing)
                  const cfg = statusCfg(listing.status)
                  return (
                    <div
                      key={listing.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '14px 16px',
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderLeft: `3px solid ${cfg.color}`,
                        borderRadius: 12,
                      }}
                    >
                      <div
                        onClick={() => { setSelected(listing); setView('detail') }}
                        style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, cursor: 'pointer', minWidth: 0 }}
                      >
                        {cover
                          ? <img src={cover} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                          : <div style={{ width: 60, height: 60, borderRadius: 8, background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 22 }}>📷</div>
                        }
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {listing.brand} {listing.model}
                          </div>
                          {listing.reference && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>Ref. {listing.reference}</div>}
                          <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                            {listing.asking_price && <span style={{ fontSize: 13, fontWeight: 600 }}>€{Number(listing.asking_price).toLocaleString()}</span>}
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmtDate(listing.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                        <div style={{ padding: '3px 10px', borderRadius: 20, background: cfg.color + '18', color: cfg.color, fontSize: 11, fontWeight: 600 }}>{cfg.label}</div>
                        {canEdit(listing.status) && (
                          <button
                            className="btn btn-sm"
                            style={{ fontSize: 11, padding: '3px 12px' }}
                            onClick={e => { e.stopPropagation(); enterEdit(listing) }}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
