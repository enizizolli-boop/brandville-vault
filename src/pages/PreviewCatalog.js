import { useState, useEffect, useMemo } from 'react'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function cleanRef(ref) {
  if (!ref) return ''
  if (ref.includes('/')) return ref.split('/').filter(Boolean).pop()
  const n = ref.match(/(\d+)$/)
  if (n) return n[1]
  return ref
}

function shortenCond(c) {
  if (!c) return ''
  if (c === 'New / unworn') return 'New'
  return c
}

function fmtPrice(eur) {
  if (!eur && eur !== 0) return '—'
  return '€' + Number(eur).toLocaleString('en-EU', { maximumFractionDigits: 0 })
}

function SectionHeader({ label, open, onToggle, count }) {
  return (
    <div className="sidebar-acc-header" onClick={onToggle}>
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {count > 0 && <span className="sidebar-acc-count">{count}</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--muted)' }}>
          <polyline points="2,3 5,7 8,3"/>
        </svg>
      </div>
    </div>
  )
}

function DetailModal({ product, onClose }) {
  const [mainIdx, setMainIdx] = useState(0)
  const images = product.images || (product.image_url ? [product.image_url] : [])

  useEffect(() => {
    setMainIdx(0)
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [product, onClose])

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 16,
        maxWidth: 820, width: '100%', maxHeight: '90vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{product.brand}</div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{product.model}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--faint)' }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', gap: 0, flex: 1 }}>
          {/* Images */}
          <div style={{ width: 360, flexShrink: 0, padding: 20 }}>
            <div style={{ aspectRatio: '1/1', borderRadius: 10, overflow: 'hidden', background: 'var(--surface2)', marginBottom: 10 }}>
              {images[mainIdx] ? (
                <img src={images[mainIdx]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="48" height="48" fill="none" stroke="var(--border-light)" strokeWidth="1" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
                    <path d="M12 3v2M12 19v2M3 12h2M19 12h2" strokeLinecap="round"/>
                  </svg>
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {images.map((url, i) => (
                  <div
                    key={i}
                    onClick={() => setMainIdx(i)}
                    style={{
                      width: 54, height: 54, borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                      border: i === mainIdx ? '2px solid var(--gold)' : '2px solid transparent',
                      flexShrink: 0,
                    }}
                  >
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div style={{ flex: 1, padding: '20px 20px 20px 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {[
                  { label: 'Reference', value: cleanRef(product.reference) || '—' },
                  { label: 'Condition', value: product.condition || '—' },
                  { label: 'Scope of delivery', value: product.scope_of_delivery || '—' },
                  { label: 'Year', value: product.year || (product.notes && /\b(19|20)\d{2}\b/.test(product.notes) ? product.notes.match(/\b(19|20)\d{2}\b/)?.[0] : null) || '—' },
                  { label: 'Category', value: product.category || '—' },
                ].map(row => (
                  <tr key={row.label}>
                    <td style={{ padding: '8px 12px 8px 0', color: 'var(--faint)', fontWeight: 500, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{row.label}</td>
                    <td style={{ padding: '8px 0', fontWeight: 500, verticalAlign: 'top' }}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Price</div>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>{fmtPrice(product.price_eur)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PreviewCatalog() {
  const [state, setState] = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [meta, setMeta] = useState(null)
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterCond, setFilterCond] = useState('')
  const [expanded, setExpanded] = useState({ brand: true, condition: true })
  const [selected, setSelected] = useState(null)

  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), [])

  useEffect(() => {
    if (!token) {
      setState('error')
      setErrorMsg('No preview token in this link. Please ask Brandville Vault for a valid link.')
      return
    }
    fetch(`${SUPABASE_URL}/functions/v1/preview-catalog?token=${encodeURIComponent(token)}`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setState('error')
          setErrorMsg(data.error)
        } else {
          setMeta({ label: data.label, expires_at: data.expires_at })
          // show only watches on preview
          setProducts((data.products || []).filter(p => (p.category || '').toLowerCase() === 'watches'))
          setState('ready')
        }
      })
      .catch(() => {
        setState('error')
        setErrorMsg('Failed to load catalog. Please try again or request a new link.')
      })
  }, [token])

  const brandOptions = useMemo(() => [...new Set(products.map(p => p.brand).filter(Boolean))].sort(), [products])
  const condOptions = useMemo(() => [...new Set(products.map(p => p.condition).filter(Boolean))].sort(), [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (filterBrand && p.brand !== filterBrand) return false
      if (filterCond && p.condition !== filterCond) return false
      if (!q) return true
      return [p.brand, p.model, p.reference, p.condition, p.scope_of_delivery]
        .some(f => (f || '').toLowerCase().includes(q))
    })
  }, [products, search, filterBrand, filterCond])

  const hasFilters = !!(filterBrand || filterCond)

  function toggleSec(key) {
    setExpanded(e => ({ ...e, [key]: !e[key] }))
  }

  if (state === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #f5f5f0)' }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
        <div style={{ color: 'var(--faint)', fontSize: 13, marginTop: 14 }}>Loading catalog…</div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #f5f5f0)', padding: 24 }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Link unavailable</div>
        <div style={{ color: 'var(--faint)', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>{errorMsg}</div>
        <div style={{ marginTop: 28, fontSize: 11, color: 'var(--faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Brandville Vault</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg, #f5f5f0)' }}>

      {/* Topbar */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-light)',
        padding: '0 24px',
        height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '0.12em', color: 'var(--gold)', textTransform: 'uppercase' }}>
          Brandville Vault
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.35, pointerEvents: 'none' }}>
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              className="catalog-searchbar"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ paddingLeft: 30 }}
            />
          </div>
          <div style={{ textAlign: 'right' }}>
            {meta?.label && <div style={{ fontWeight: 600, fontSize: 12 }}>{meta.label}</div>}
            <div style={{ fontSize: 11, color: 'var(--faint)' }}>Valid until {meta?.expires_at ? fmtDate(meta.expires_at) : '—'}</div>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="catalog-layout" style={{ flex: 1 }}>

        {/* Sidebar */}
        <aside className="catalog-sidebar">
          <div className="sidebar-header-row">
            <span className="sidebar-header-title">FILTERS</span>
            {hasFilters && (
              <button className="sidebar-clear" onClick={() => { setFilterBrand(''); setFilterCond('') }}>Clear all</button>
            )}
          </div>

          {/* Brand */}
          <div className="sidebar-acc-section">
            <SectionHeader label="Brand" open={expanded.brand} onToggle={() => toggleSec('brand')} count={filterBrand ? 1 : 0} />
            {expanded.brand && (
              <div className="sidebar-acc-body">
                <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
                  <option value="">All brands</option>
                  {brandOptions.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Condition */}
          <div className="sidebar-acc-section">
            <SectionHeader label="Condition" open={expanded.condition} onToggle={() => toggleSec('condition')} count={filterCond ? 1 : 0} />
            {expanded.condition && (
              <div className="sidebar-acc-body">
                <label className="sidebar-radio-row">
                  <input type="radio" name="cond" checked={filterCond === ''} onChange={() => setFilterCond('')} />
                  <span>All conditions</span>
                </label>
                {condOptions.map(cond => (
                  <label key={cond} className="sidebar-radio-row">
                    <input type="radio" name="cond" checked={filterCond === cond} onChange={() => setFilterCond(cond)} />
                    <span>{cond.length > 22 ? cond.slice(0, 22) + '…' : cond}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Count */}
          <div style={{ padding: '14px 18px', fontSize: 11, color: 'var(--faint)' }}>
            {filtered.length}{filtered.length !== products.length ? ` of ${products.length}` : ''} watch{products.length !== 1 ? 'es' : ''}
          </div>
        </aside>

        {/* Content */}
        <div className="catalog-content">
          {filtered.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 60 }}>
              {search || hasFilters ? 'No watches match your filters.' : 'No available watches.'}
            </div>
          ) : (
            <div className="watch-grid">
              {filtered.map(w => (
                <div
                  className="watch-card"
                  key={w.id}
                  onClick={() => setSelected(w)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="card-img-wrap">
                    {w.image_url ? (
                      <img src={w.image_url} alt="" loading="lazy" />
                    ) : (
                      <div style={{ width: '100%', aspectRatio: '1/1', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="36" height="36" fill="none" stroke="var(--border-light)" strokeWidth="1.2" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
                          <path d="M12 3v2M12 19v2M3 12h2M19 12h2" strokeLinecap="round"/>
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="card-body">
                    <div className="card-brand">{w.brand}</div>
                    <div className="card-model">{w.model}</div>
                    <div className="card-ref">{cleanRef(w.reference) ? `Ref. ${cleanRef(w.reference)}` : '—'}</div>
                    <div className="card-meta">
                      {shortenCond(w.condition) && <span className="card-cond-pill">{shortenCond(w.condition)}</span>}
                      {w.scope_of_delivery && (
                        <span className="card-cond-pill" style={{ marginLeft: 4, background: 'var(--surface2)', color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}>
                          {w.scope_of_delivery}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="card-price-row">
                    <div className="card-price-block">
                      <div className="card-price">{fmtPrice(w.price_eur)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 24px', textAlign: 'center', fontSize: 11, color: 'var(--faint)', borderTop: '1px solid var(--border-light)', background: 'var(--surface)', lineHeight: 1.8 }}>
        © Brandville Vault — Confidential inventory preview · Not for distribution
      </div>

      {/* Detail modal */}
      {selected && <DetailModal product={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
