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
  draft:          { label: 'Draft',            color: '#888' },
  pending_review: { label: 'Pending Review',   color: '#f59e0b' },
  approved:       { label: 'Approved',         color: '#22c55e' },
  rejected:       { label: 'Rejected',         color: '#ef4444' },
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

export default function SupplierDashboard() {
  const { user, profile } = useAuth()
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list' | 'new' | 'detail'
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [images, setImages] = useState([])
  const [previews, setPreviews] = useState([])
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { fetchListings() }, [])

  async function fetchListings() {
    setLoading(true)
    const { data } = await supabase
      .from('supplier_listings')
      .select('*, supplier_listing_images(url, position)')
      .eq('supplier_id', user.id)
      .order('created_at', { ascending: false })
    setListings(data || [])
    setLoading(false)
  }

  function handleImagesChange(e) {
    const files = Array.from(e.target.files)
    setImages(prev => [...prev, ...files])
    setPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))])
  }

  function removeImage(idx) {
    setImages(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setImages([])
    setPreviews([])
    setError('')
  }

  async function handleSave(submitForReview = false) {
    if (!form.brand) { setError('Brand is required.'); return }
    if (!form.model) { setError('Model is required.'); return }
    if (submitForReview && images.length === 0) {
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

      for (let i = 0; i < images.length; i++) {
        const file = images[i]
        const ext = file.name.split('.').pop()
        const path = `supplier_listings/${listing.id}/${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('watch-images').upload(path, file)
        if (upErr) continue
        const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path)
        await supabase.from('supplier_listing_images').insert({ listing_id: listing.id, url: publicUrl, position: i })
      }

      if (submitForReview) await notifyAgents(listing, profile?.full_name || 'A supplier')

      setMsg(submitForReview
        ? 'Listing submitted for review. An agent will be in touch.'
        : 'Draft saved.')
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

  if (view === 'new') {
    return (
      <div className="page">
        <Topbar />
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button className="btn" onClick={() => { resetForm(); setView('list') }} style={{ fontSize: 13 }}>← Back</button>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>New Listing</h2>
          </div>

          {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <select className="input" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}>
              <option value="">Brand *</option>
              {BRANDS.map(b => <option key={b}>{b}</option>)}
            </select>
            <input className="input" placeholder="Model *" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            <input className="input" placeholder="Reference" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
            <select className="input" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
              {CONDITIONS.map(c => <option key={c}>{c}</option>)}
            </select>
            <select className="input" value={form.scope_of_delivery} onChange={e => setForm(f => ({ ...f, scope_of_delivery: e.target.value }))}>
              <option value="">Scope of delivery</option>
              {SCOPES.map(s => <option key={s}>{s}</option>)}
            </select>
            <input className="input" placeholder="Asking price (€) — optional" type="number" value={form.asking_price} onChange={e => setForm(f => ({ ...f, asking_price: e.target.value }))} />
            <textarea className="input" placeholder="Notes" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />

            <div>
              <label className="btn btn-full" style={{ cursor: 'pointer', textAlign: 'center', marginBottom: 8 }}>
                + Add Photos
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleImagesChange} />
              </label>
              {previews.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {previews.map((src, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={src} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-light)' }} />
                      <button onClick={() => removeImage(i)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn btn-full" onClick={() => handleSave(false)} disabled={saving || submitting}>
                {saving ? 'Saving…' : 'Save as Draft'}
              </button>
              <button className="btn btn-dark btn-full" onClick={() => handleSave(true)} disabled={saving || submitting}>
                {submitting ? 'Submitting…' : 'Submit for Review'}
              </button>
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

          <div style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: cfg.color + '22', color: cfg.color, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
            {cfg.label}
          </div>

          {selected.status === 'rejected' && selected.rejection_reason && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#ef4444' }}>
              <strong>Reason:</strong> {selected.rejection_reason}
            </div>
          )}

          {imgs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {imgs.map((img, i) => (
                <img key={i} src={img.url} alt="" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-light)' }} />
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
            {selected.reference && <div><span style={{ color: 'var(--faint)' }}>Reference:</span> {selected.reference}</div>}
            {selected.condition && <div><span style={{ color: 'var(--faint)' }}>Condition:</span> {selected.condition}</div>}
            {selected.scope_of_delivery && <div><span style={{ color: 'var(--faint)' }}>Scope:</span> {selected.scope_of_delivery}</div>}
            {selected.asking_price && <div><span style={{ color: 'var(--faint)' }}>Asking price:</span> €{selected.asking_price.toLocaleString()}</div>}
            {selected.selling_price && <div><span style={{ color: 'var(--faint)' }}>Selling price:</span> €{selected.selling_price.toLocaleString()}</div>}
            {selected.notes && <div><span style={{ color: 'var(--faint)' }}>Notes:</span> {selected.notes}</div>}
          </div>

          {selected.status === 'draft' && (
            <button className="btn btn-dark btn-full" style={{ marginTop: 20 }} onClick={() => submitDraft(selected)}>
              Submit for Review
            </button>
          )}
          {selected.status === 'rejected' && (
            <button className="btn btn-dark btn-full" style={{ marginTop: 20 }} onClick={() => submitDraft(selected)}>
              Resubmit for Review
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <Topbar />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>My Listings</h2>
          <button className="btn btn-dark" onClick={() => { resetForm(); setView('new') }}>+ New Listing</button>
        </div>

        {msg && <div className="success-msg" style={{ marginBottom: 16 }}>{msg}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
        ) : listings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--faint)', fontSize: 14 }}>
            No listings yet. Click <strong>New Listing</strong> to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {listings.map(listing => {
              const cover = getCover(listing)
              const cfg = statusCfg(listing.status)
              return (
                <div
                  key={listing.id}
                  onClick={() => { setSelected(listing); setView('detail') }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 12, cursor: 'pointer' }}
                >
                  {cover
                    ? <img src={cover} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                    : <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--border-light)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📷</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{listing.brand} {listing.model}</div>
                    {listing.reference && <div style={{ fontSize: 12, color: 'var(--faint)' }}>Ref. {listing.reference}</div>}
                    <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
                      {new Date(listing.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ padding: '3px 10px', borderRadius: 20, background: cfg.color + '22', color: cfg.color, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {cfg.label}
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
