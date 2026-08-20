import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

const JEWELLERY_TYPES = ['Ring', 'Necklace', 'Bracelet', 'Earrings', 'Pendant', 'Brooch', 'Bangle', 'Set', 'Other']
const METALS = ['18k Yellow Gold', '18k White Gold', '18k Rose Gold', 'Platinum', 'Sterling Silver', 'Vermeil', 'Gold (other)', 'Other']
const STONES = ['Diamond', 'Ruby', 'Sapphire', 'Emerald', 'Pearl', 'Amethyst', 'Moissanite', 'No Stone', 'Other']
const CONDITIONS = ['New', 'Excellent', 'Pre-owned', 'Used']
const PRICE_CURRENCIES = [
  { value: 'EUR', label: '€ EUR' },
  { value: 'USD', label: '$ USD' },
  { value: 'CNY', label: '¥ CNY' },
  { value: 'HKD', label: 'HK$ HKD' },
]
const CURRENCY_SYM = { EUR: '€', USD: '$', CNY: '¥', HKD: 'HK$' }

const EMPTY_FORM = {
  jewellery_type: '',
  brand: '',
  model: '',
  metal: '',
  stone: '',
  size_info: '',
  condition: 'Pre-owned',
  asking_price: '',
  asking_price_currency: 'EUR',
  notes: '',
}

const STATUS_CONFIG = {
  draft:          { color: '#94a3b8', label: 'Draft' },
  pending_review: { color: '#f59e0b', label: 'Pending Review' },
  approved:       { color: '#22c55e', label: 'Approved' },
  rejected:       { color: '#ef4444', label: 'Rejected' },
  sold:           { color: '#6b7280', label: 'Sold' },
}

const fl = { color: 'var(--faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }

async function notifyJewelleryAgents(listing, supplierName) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({
        action: 'supplier_submitted',
        supplier_name: supplierName,
        brand: listing.jewellery_type,
        model: listing.metal,
        reference: listing.brand || '',
        asking_price: listing.asking_price,
      }),
    })
  } catch (e) { console.log('Notify error:', e) }
}

export default function JewellerySupplierDashboard() {
  const { user, profile } = useAuth()
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list')
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
  const [filterStatus, setFilterStatus] = useState('all')
  const [supSearch, setSupSearch] = useState('')
  const [lightboxIdx, setLightboxIdx] = useState(null)
  const [lightboxImgs, setLightboxImgs] = useState([])
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 680)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 680)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => { fetchListings() }, []) // eslint-disable-line

  useEffect(() => {
    if (lightboxIdx === null) return
    const handler = e => {
      if (e.key === 'ArrowRight') setLightboxIdx(i => (i + 1) % lightboxImgs.length)
      else if (e.key === 'ArrowLeft') setLightboxIdx(i => (i - 1 + lightboxImgs.length) % lightboxImgs.length)
      else if (e.key === 'Escape') { setLightboxIdx(null); setLightboxImgs([]) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightboxIdx, lightboxImgs])

  async function fetchListings() {
    setLoading(true)
    const { data } = await supabase
      .from('supplier_listings')
      .select('*, supplier_listing_images(id, url, position)')
      .eq('supplier_id', user.id)
      .eq('category', 'Jewellery')
      .order('created_at', { ascending: false })
    setListings(data || [])
    setLoading(false)
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
      jewellery_type: listing.jewellery_type || '',
      brand: listing.brand || '',
      model: listing.model || '',
      metal: listing.metal || '',
      stone: listing.stone || '',
      size_info: listing.size_info || '',
      condition: listing.condition || 'Pre-owned',
      asking_price: listing.asking_price || '',
      asking_price_currency: listing.asking_price_currency || 'EUR',
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
    if (!form.jewellery_type) { setError('Jewellery type is required.'); return }
    if (!form.metal) { setError('Metal is required.'); return }
    if (!form.asking_price) { setError('Asking price is required.'); return }
    if (newImages.length === 0) { setError('At least one photo is required.'); return }

    submitForReview ? setSubmitting(true) : setSaving(true)
    setError('')

    try {
      const { data: listing, error: lErr } = await supabase
        .from('supplier_listings')
        .insert({
          supplier_id: user.id,
          category: 'Jewellery',
          jewellery_type: form.jewellery_type,
          brand: form.brand || null,
          model: form.model || null,
          metal: form.metal,
          stone: form.stone || null,
          size_info: form.size_info || null,
          condition: form.condition || null,
          asking_price: Number(form.asking_price),
          asking_price_currency: form.asking_price_currency || 'EUR',
          notes: form.notes || null,
          status: submitForReview ? 'pending_review' : 'draft',
        })
        .select()
        .single()
      if (lErr) throw lErr

      await uploadImages(listing.id, newImages, 0)
      if (submitForReview) await notifyJewelleryAgents(listing, profile?.full_name || 'A supplier')

      setMsg(submitForReview ? 'Listing submitted for review. A jewellery agent will be in touch.' : 'Draft saved.')
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
    if (!form.jewellery_type) { setError('Jewellery type is required.'); return }
    if (!form.metal) { setError('Metal is required.'); return }
    if (!form.asking_price) { setError('Asking price is required.'); return }
    const totalImages = existingImgs.length + newImages.length
    if (totalImages === 0) { setError('At least one photo is required.'); return }

    submitForReview ? setSubmitting(true) : setSaving(true)
    setError('')

    try {
      const newStatus = submitForReview ? 'pending_review' : selected.status
      const { error: uErr } = await supabase
        .from('supplier_listings')
        .update({
          jewellery_type: form.jewellery_type,
          brand: form.brand || null,
          model: form.model || null,
          metal: form.metal,
          stone: form.stone || null,
          size_info: form.size_info || null,
          condition: form.condition || null,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
          asking_price_currency: form.asking_price_currency || 'EUR',
          notes: form.notes || null,
          status: newStatus,
        })
        .eq('id', selected.id)
      if (uErr) throw uErr

      for (const id of removedImgIds) {
        await supabase.from('supplier_listing_images').delete().eq('id', id)
      }
      await uploadImages(selected.id, newImages, existingImgs.length)

      if (submitForReview && selected.status !== 'pending_review') {
        await notifyJewelleryAgents({ ...selected, ...form }, profile?.full_name || 'A supplier')
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
    if (!window.confirm('Submit this listing for review?')) return
    const { error } = await supabase.from('supplier_listings').update({ status: 'pending_review' }).eq('id', listing.id)
    if (error) { alert('Error: ' + error.message); return }
    await notifyJewelleryAgents(listing, profile?.full_name || 'A supplier')
    fetchListings()
  }

  async function markAsSold(listing, e) {
    if (e) e.stopPropagation()
    if (!window.confirm('Mark this item as sold? This will prevent it from being posted.')) return
    const { error } = await supabase.from('supplier_listings').update({ status: 'sold' }).eq('id', listing.id)
    if (error) { alert('Error: ' + error.message); return }
    fetchListings()
    setSelected(prev => prev?.id === listing.id ? { ...prev, status: 'sold' } : prev)
  }

  function getTitle(listing) {
    const parts = []
    if (listing.brand) parts.push(listing.brand)
    if (listing.jewellery_type) parts.push(listing.jewellery_type)
    return parts.join(' · ') || 'Jewellery Item'
  }

  function getSubtitle(listing) {
    const parts = []
    if (listing.metal) parts.push(listing.metal)
    if (listing.stone && listing.stone !== 'No Stone') parts.push(listing.stone)
    return parts.join(' · ')
  }

  function getCover(listing) {
    const imgs = (listing.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    return imgs[0]?.url || null
  }

  const fmtDate = d => {
    const dt = new Date(d)
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
  }

  const canEdit = s => s === 'draft' || s === 'rejected' || s === 'pending_review'

  const openLb = (imgs, idx) => { setLightboxImgs(imgs); setLightboxIdx(idx) }
  const closeLb = () => { setLightboxIdx(null); setLightboxImgs([]) }

  const filteredListings = listings.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    if (supSearch) {
      const q = supSearch.toLowerCase()
      const txt = `${l.jewellery_type || ''} ${l.brand || ''} ${l.model || ''} ${l.metal || ''}`.toLowerCase()
      if (!txt.includes(q)) return false
    }
    return true
  })

  // --- Icon helpers ---
  const IconGem = () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
      <line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="8.5" x2="22" y2="8.5"/>
    </svg>
  )
  const IconCheck = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
  const IconX = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>

  const sbBtn = (filter, label, icon) => {
    const isActive = filter === 'all'
      ? (view === 'list' && filterStatus === 'all') || view === 'detail' || view === 'new' || view === 'edit'
      : view === 'list' && filterStatus === filter
    return (
      <button
        onClick={() => { setFilterStatus(filter); setView('list'); setSelected(null); setMobileMenuOpen(false) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '8px 16px',
          border: 'none',
          borderLeft: isActive ? '2px solid #b8965a' : '2px solid transparent',
          cursor: 'pointer', textAlign: 'left',
          background: isActive ? '#faf6f0' : 'transparent',
          color: isActive ? '#b8965a' : '#374151',
          fontWeight: isActive ? 600 : 400, fontSize: 14,
        }}
      >
        <span style={{ color: isActive ? '#b8965a' : '#6b7280', display: 'flex', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
      </button>
    )
  }

  // --- Form view ---
  const formView = (isEdit) => (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 40px' }}>
      <button onClick={() => { resetForm(); setView(isEdit ? 'detail' : 'list') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b8965a', fontWeight: 600, fontSize: 14, padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
        ← Back
      </button>
      <div style={{ maxWidth: 600 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 20px' }}>{isEdit ? 'Edit Listing' : 'New Jewellery Listing'}</h2>

        {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Jewellery Type */}
          <div>
            <div style={fl}>Jewellery Type *</div>
            <select className="input" value={form.jewellery_type} onChange={e => setForm(f => ({ ...f, jewellery_type: e.target.value }))}>
              <option value="">Select type</option>
              {JEWELLERY_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {/* Brand & Description row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={fl}>Brand / Designer</div>
              <input className="input" placeholder="e.g. Cartier, Van Cleef" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
            </div>
            <div>
              <div style={fl}>Description</div>
              <input className="input" placeholder="e.g. Love Ring, Alhambra" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            </div>
          </div>

          {/* Metal & Stone row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={fl}>Metal *</div>
              <select className="input" value={form.metal} onChange={e => setForm(f => ({ ...f, metal: e.target.value }))}>
                <option value="">Select metal</option>
                {METALS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <div style={fl}>Stone / Gemstone</div>
              <select className="input" value={form.stone} onChange={e => setForm(f => ({ ...f, stone: e.target.value }))}>
                <option value="">Select stone</option>
                {STONES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Size & Condition row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={fl}>Size / Measurements</div>
              <input className="input" placeholder="e.g. Ring size 53, 45cm chain" value={form.size_info} onChange={e => setForm(f => ({ ...f, size_info: e.target.value }))} />
            </div>
            <div>
              <div style={fl}>Condition</div>
              <select className="input" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                {CONDITIONS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Asking price */}
          <div>
            <div style={fl}>Asking Price *</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="input" value={form.asking_price_currency} onChange={e => setForm(f => ({ ...f, asking_price_currency: e.target.value }))} style={{ width: 110, flexShrink: 0 }}>
                {PRICE_CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input className="input" type="number" placeholder="0" value={form.asking_price} onChange={e => setForm(f => ({ ...f, asking_price: e.target.value }))} style={{ flex: 1 }} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <div style={fl}>Notes</div>
            <textarea className="input" rows={3} placeholder="Any relevant details about the item..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />
          </div>

          {/* Photos */}
          <div>
            <div style={fl}>Photos *</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {isEdit && existingImgs.filter(img => !removedImgIds.includes(img.id)).map(img => (
                <div key={img.id} style={{ position: 'relative' }}>
                  <img src={img.url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <button onClick={() => { setRemovedImgIds(ids => [...ids, img.id]); setExistingImgs(prev => prev.filter(i => i.id !== img.id)) }} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              ))}
              {newPreviews.map((src, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={src} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px dashed #e5e7eb', opacity: 0.9 }} />
                  <button onClick={() => { setNewImages(arr => arr.filter((_, j) => j !== i)); setNewPreviews(arr => arr.filter((_, j) => j !== i)) }} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              ))}
              <label style={{ width: 80, height: 80, borderRadius: 8, border: '2px dashed #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#9ca3af', fontSize: 28, flexShrink: 0 }}>
                +
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => {
                  const files = Array.from(e.target.files)
                  setNewImages(prev => [...prev, ...files])
                  setNewPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))])
                  e.target.value = ''
                }} />
              </label>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button
              className="btn"
              onClick={() => isEdit ? handleEdit(false) : handleCreate(false)}
              disabled={saving || submitting}
              style={{ fontSize: 14 }}
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              className="btn btn-dark"
              onClick={() => isEdit ? handleEdit(true) : handleCreate(true)}
              disabled={saving || submitting}
              style={{ fontSize: 14, background: '#b8965a', borderColor: '#b8965a' }}
            >
              {submitting ? 'Submitting…' : 'Submit for Review'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  // --- Detail view ---
  const detailView = () => {
    if (!selected) return null
    const imgs = (selected.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    const cfg = STATUS_CONFIG[selected.status] || STATUS_CONFIG.draft
    const sym = CURRENCY_SYM[selected.asking_price_currency] || ''
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 40px' }}>
        <button onClick={() => { setView('list'); setSelected(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b8965a', fontWeight: 600, fontSize: 14, padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
          ← Back
        </button>
        <div style={{ maxWidth: 600 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{getTitle(selected)}</h2>
              {getSubtitle(selected) && <div style={{ fontSize: 13, color: '#6b7280' }}>{getSubtitle(selected)}</div>}
            </div>
            <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: cfg.color + '22', color: cfg.color }}>
              {cfg.label}
            </span>
          </div>

          {imgs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {imgs.map((img, i) => (
                <img key={i} src={img.url} alt="" onClick={() => openLb(imgs.map(x => x.url), i)} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'zoom-in' }} />
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {[
              ['Type', selected.jewellery_type],
              ['Metal', selected.metal],
              ['Stone', selected.stone],
              ['Size', selected.size_info],
              ['Condition', selected.condition],
              ['Asking Price', selected.asking_price ? `${sym}${Number(selected.asking_price).toLocaleString()}` : null],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label}>
                <div style={fl}>{label}</div>
                <div style={{ fontSize: 14 }}>{value}</div>
              </div>
            ))}
          </div>

          {selected.notes && (
            <div style={{ marginBottom: 16 }}>
              <div style={fl}>Notes</div>
              <div style={{ fontSize: 14, color: '#374151', whiteSpace: 'pre-line' }}>{selected.notes}</div>
            </div>
          )}

          {selected.rejection_reason && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#b91c1c' }}>
              <strong>Rejection reason:</strong> {selected.rejection_reason}
            </div>
          )}

          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20 }}>
            Submitted on {fmtDate(selected.created_at)}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {canEdit(selected.status) && (
              <button className="btn" onClick={() => enterEdit(selected)} style={{ fontSize: 14 }}>Edit Listing</button>
            )}
            {(selected.status === 'draft' || selected.status === 'rejected') && (
              <button className="btn btn-dark" onClick={() => submitDraft(selected)} style={{ fontSize: 14, background: '#b8965a', borderColor: '#b8965a' }}>Submit for Review</button>
            )}
            {selected.status === 'approved' && (
              <button className="btn" onClick={e => markAsSold(selected, e)} style={{ fontSize: 14, borderColor: '#ef4444', color: '#ef4444' }}>Mark as Sold</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // --- List view ---
  const listView = () => (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 40px' }}>
      {msg && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', color: '#15803d', fontSize: 13, marginBottom: 16 }}>✓ {msg}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>My Listings</h2>
          <div style={{ fontSize: 13, color: '#6b7280' }}>{filteredListings.length} item{filteredListings.length !== 1 ? 's' : ''}</div>
        </div>
        <button
          onClick={() => { resetForm(); setView('new') }}
          style={{ background: '#b8965a', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          + New Listing
        </button>
      </div>

      <input
        className="input"
        placeholder="Search listings…"
        value={supSearch}
        onChange={e => setSupSearch(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af', fontSize: 13 }}>Loading…</div>
      ) : filteredListings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>No listings yet</div>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>Submit your first item to get started.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredListings.map(listing => {
            const cover = getCover(listing)
            const cfg = STATUS_CONFIG[listing.status] || STATUS_CONFIG.draft
            const sym = CURRENCY_SYM[listing.asking_price_currency] || ''
            return (
              <div
                key={listing.id}
                onClick={() => { setSelected(listing); setView('detail') }}
                style={{ display: 'flex', gap: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#b8965a'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#e5e7eb'}
              >
                {cover ? (
                  <img src={cover} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #e5e7eb' }} />
                ) : (
                  <div style={{ width: 56, height: 56, borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#d1d5db' }}>
                    <IconGem />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{getTitle(listing)}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{getSubtitle(listing)}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: cfg.color + '22', color: cfg.color }}>{cfg.label}</span>
                    {listing.asking_price && <span style={{ fontSize: 12, color: '#9ca3af' }}>{sym}{Number(listing.asking_price).toLocaleString()}</span>}
                  </div>
                </div>
                {canEdit(listing.status) && (
                  <button
                    onClick={e => { e.stopPropagation(); enterEdit(listing) }}
                    className="btn btn-sm"
                    style={{ fontSize: 11, alignSelf: 'center', flexShrink: 0 }}
                  >
                    Edit
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const sidebarContent = (
    <>
      <div style={{ padding: '0 16px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9ca3af' }}>Listings</div>
      {sbBtn('all', 'My Listings', <IconGem />)}
      {sbBtn('approved', 'Approved', <IconCheck />)}
      {sbBtn('rejected', 'Rejected', <IconX />)}
      <div style={{ flex: 1 }} />
      <div style={{ margin: '16px 12px 0', background: '#fdf8f2', border: '1px solid #e9d8bc', borderRadius: 12, padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f5ede0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" fill="none" stroke="#b8965a" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Need help?</span>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>Our team is here to help you.</div>
      </div>
    </>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
      <Topbar />
      <div style={{ display: 'flex', flex: 1, alignItems: 'flex-start' }}>

        {/* Desktop sidebar */}
        {!isMobile && (
          <aside style={{ width: 230, flexShrink: 0, borderRight: '1px solid #e5e7eb', background: '#fff', display: 'flex', flexDirection: 'column', padding: '20px 0 16px', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
            {sidebarContent}
          </aside>
        )}

        {/* Mobile top bar */}
        {isMobile && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 16px', display: 'flex', alignItems: 'center' }}>
            <button onClick={() => setMobileMenuOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#374151' }}>
              <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
        )}

        {/* Mobile drawer */}
        {isMobile && mobileMenuOpen && (
          <>
            <div onClick={() => setMobileMenuOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }} />
            <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 260, background: '#fff', zIndex: 201, display: 'flex', flexDirection: 'column', padding: '20px 0 16px', overflowY: 'auto', boxShadow: '4px 0 24px rgba(0,0,0,0.15)' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 16px', marginBottom: 16 }}>
                <button onClick={() => setMobileMenuOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18 }}>✕</button>
              </div>
              {sidebarContent}
            </div>
          </>
        )}

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', marginTop: isMobile ? 52 : 0 }}>
          {view === 'list' && listView()}
          {view === 'new' && formView(false)}
          {view === 'edit' && formView(true)}
          {view === 'detail' && detailView()}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div onClick={closeLb} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={e => { e.stopPropagation(); setLightboxIdx(i => (i - 1 + lightboxImgs.length) % lightboxImgs.length) }} style={{ position: 'absolute', left: 16, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', color: '#fff', fontSize: 20 }}>‹</button>
          <img src={lightboxImgs[lightboxIdx]} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} />
          <button onClick={e => { e.stopPropagation(); setLightboxIdx(i => (i + 1) % lightboxImgs.length) }} style={{ position: 'absolute', right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', color: '#fff', fontSize: 20 }}>›</button>
          <button onClick={closeLb} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer', color: '#fff', fontSize: 18 }}>✕</button>
        </div>
      )}
    </div>
  )
}
