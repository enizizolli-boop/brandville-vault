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
  asking_price: '', notes: '',
}

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
          ...form,
          supplier_id: user.id,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
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
          ...form,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
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

  const statusCfg = s => STATUS_CONFIG[s] || STATUS_CONFIG.draft

  const canEdit = s => s === 'draft' || s === 'rejected' || s === 'pending_review'

  if (view === 'new' || view === 'edit') {
    const isEdit = view === 'edit'
    const isDraft = !isEdit || selected?.status === 'draft' || selected?.status === 'rejected'

    return (
      <div className="page">
        <Topbar />
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
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
              <div style={fieldLabel}>Asking price (€)</div>
              <input className="input" placeholder="Optional" type="number" value={form.asking_price} onChange={e => setForm(f => ({ ...f, asking_price: e.target.value }))} />
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
      </div>
    )
  }

  if (view === 'detail' && selected) {
    const imgs = (selected.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    const cfg = statusCfg(selected.status)
    return (
      <div className="page">
        <Topbar />
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button className="btn" onClick={() => { setView('list'); setSelected(null) }} style={{ fontSize: 13 }}>← Back</button>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selected.brand} {selected.model}</h2>
          </div>

          <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, background: cfg.color + '20', color: cfg.color, fontSize: 12, fontWeight: 600, marginBottom: 20 }}>
            {cfg.label}
          </div>

          {selected.status === 'rejected' && selected.rejection_reason && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#ef4444' }}>
              <strong>Rejection reason:</strong> {selected.rejection_reason}
            </div>
          )}

          {imgs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {imgs.map((img, i) => (
                <img key={i} src={img.url} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border-light)' }} />
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '16px 18px' }}>
            {selected.reference && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--faint)' }}>Reference</span><span>{selected.reference}</span></div>}
            {selected.condition && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--faint)' }}>Condition</span><span>{selected.condition}</span></div>}
            {selected.scope_of_delivery && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--faint)' }}>Scope</span><span>{selected.scope_of_delivery}</span></div>}
            {selected.asking_price && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--faint)' }}>Asking price</span><span style={{ fontWeight: 600 }}>€{Number(selected.asking_price).toLocaleString()}</span></div>}
            {selected.notes && <div style={{ paddingTop: 8, borderTop: '1px solid var(--border-light)', color: 'var(--faint)', fontSize: 13, lineHeight: 1.5 }}>{selected.notes}</div>}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            {canEdit(selected.status) && (
              <button className="btn btn-full" onClick={() => enterEdit(selected)}>Edit</button>
            )}
            {selected.status === 'draft' && (
              <button className="btn btn-dark btn-full" onClick={() => submitDraft(selected)}>Submit for Review</button>
            )}
            {selected.status === 'rejected' && (
              <button className="btn btn-dark btn-full" onClick={() => submitDraft(selected)}>Resubmit for Review</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <Topbar />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>My Listings</h2>
            {listings.length > 0 && <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 2 }}>{listings.length} item{listings.length !== 1 ? 's' : ''}</div>}
          </div>
          <button className="btn btn-dark" onClick={() => { resetForm(); setView('new') }}>+ New Listing</button>
        </div>

        {msg && <div className="success-msg" style={{ marginBottom: 16 }}>{msg}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
        ) : listings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--faint)', fontSize: 14 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>No listings yet</div>
            <div>Submit your first item to get started.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {listings.map(listing => {
              const cover = getCover(listing)
              const cfg = statusCfg(listing.status)
              return (
                <div
                  key={listing.id}
                  onClick={() => { setSelected(listing); setView('detail') }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 16px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border-light)',
                    borderLeft: `3px solid ${cfg.color}`,
                    borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  {cover
                    ? <img src={cover} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                    : <div style={{ width: 60, height: 60, borderRadius: 8, background: 'var(--border-light)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📷</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {listing.brand} {listing.model}
                    </div>
                    {listing.reference && <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 1 }}>Ref. {listing.reference}</div>}
                    <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                      {listing.asking_price && (
                        <span style={{ fontSize: 13, fontWeight: 600 }}>€{Number(listing.asking_price).toLocaleString()}</span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--faint)' }}>{new Date(listing.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                    <div style={{ padding: '3px 10px', borderRadius: 20, background: cfg.color + '20', color: cfg.color, fontSize: 11, fontWeight: 600 }}>
                      {cfg.label}
                    </div>
                    {canEdit(listing.status) && (
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: 11, padding: '3px 10px' }}
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
    </div>
  )
}
