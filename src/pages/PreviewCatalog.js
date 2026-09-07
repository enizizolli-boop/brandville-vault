import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

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

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
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

export default function PreviewCatalog() {
  const navigate = useNavigate()
  const [state, setState] = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [meta, setMeta] = useState(null)
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterCond, setFilterCond] = useState('')
  const [expanded, setExpanded] = useState({ brand: true, condition: true })

  const { token } = useParams()

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
          const watches = (data.products || []).filter(p => (p.category || '').toLowerCase() === 'watches')
          setProducts(watches)
          sessionStorage.setItem('bv-preview-token', token)
          sessionStorage.setItem('bv-preview-meta', JSON.stringify({ label: data.label, expires_at: data.expires_at }))
          setState('ready')
        }
      })
      .catch(() => {
        setState('error')
        setErrorMsg('Failed to load catalog. Please try again or request a new link.')
      })
  }, [token])

  const heroImg = useMemo(() => products.find(p => p.image_url)?.image_url || null, [products])
  const brandOptions = useMemo(() => [...new Set(products.map(p => p.brand).filter(Boolean))].sort(), [products])
  const condOptions = useMemo(() => [...new Set(products.map(p => p.condition).filter(Boolean))].sort(), [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter(p => {
        if ((p.price_eur ?? 0) > 30000) return false
        if (filterBrand && p.brand !== filterBrand) return false
        if (filterCond && p.condition !== filterCond) return false
        if (!q) return true
        return [p.brand, p.model, p.reference, p.condition].some(f => (f || '').toLowerCase().includes(q))
      })
      .sort((a, b) => (a.price_eur ?? Infinity) - (b.price_eur ?? Infinity))
  }, [products, search, filterBrand, filterCond])

  const hasFilters = !!(filterBrand || filterCond)

  function toggleSec(key) { setExpanded(e => ({ ...e, [key]: !e[key] })) }

  function openProduct(w) {
    sessionStorage.setItem('bv-preview-product', JSON.stringify(w))
    navigate(`/preview/${token}/detail`)
  }

  if (state === 'loading') {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Link unavailable</div>
        <div style={{ color: 'var(--faint)', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>{errorMsg}</div>
      </div>
    )
  }

  return (
    <div className="page">

      {/* ── Simple branded header (no nav links) ── */}
      <div className="topbar">
        <div className="topbar-logo" style={{ cursor: 'default' }}>
          Brandville <span>Vault</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {meta?.label && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</div>
              <div style={{ fontSize: 11, color: 'var(--faint)' }}>Valid until {fmtDate(meta.expires_at)}</div>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--faint)', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 20, letterSpacing: '0.04em' }}>
            Confidential
          </div>
        </div>
      </div>

      {/* ── Hero image ── */}
      <div style={{
        position: 'relative', width: '100%', height: 260, overflow: 'hidden',
        background: heroImg ? 'transparent' : '#1a1612',
      }}>
        {heroImg && (
          <img
            src={heroImg}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%', display: 'block' }}
          />
        )}
        {/* Dark overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(10,8,5,0.55) 0%, rgba(10,8,5,0.75) 100%)' }} />
        {/* Hero text */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', color: '#b8965a', textTransform: 'uppercase' }}>Brandville Vault</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>Watch Inventory</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            {products.length} watches available · Confidential preview
          </div>
        </div>
      </div>

      {/* ── Search bar ── */}
      <div className="catalog-searchbar">
        <div className="catalog-searchbar-inner">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="csb-icon">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            className="csb-input"
            placeholder="Search by brand, model, reference..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Sidebar + grid ── */}
      <div className="catalog-layout">
        <aside className="catalog-sidebar">
          <div className="sidebar-header-row">
            <span className="sidebar-header-title">FILTERS</span>
            {hasFilters && (
              <button className="sidebar-clear" onClick={() => { setFilterBrand(''); setFilterCond('') }}>Clear all</button>
            )}
          </div>

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

          <div style={{ padding: '14px 18px', fontSize: 11, color: 'var(--faint)' }}>
            {filtered.length}{filtered.length !== products.length ? ` of ${products.length}` : ''} watch{products.length !== 1 ? 'es' : ''}
          </div>
        </aside>

        <div className="catalog-content">
          {filtered.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 60 }}>
              {search || hasFilters ? 'No watches match your filters.' : 'No available watches.'}
            </div>
          ) : (
            <div className="watch-grid">
              {filtered.map(w => (
                <div className="watch-card" key={w.id} onClick={() => openProduct(w)} style={{ cursor: 'pointer' }}>
                  <div className="card-img-wrap">
                    {w.image_url ? (
                      <img src={w.image_url} alt="" loading="lazy" />
                    ) : (
                      <div style={{ width: '100%', aspectRatio: '1/1', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="40" height="40" fill="none" stroke="var(--border-light)" strokeWidth="1.2" viewBox="0 0 24 24">
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
    </div>
  )
}
