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
  if (c === 'Like new') return 'Like new'
  if (c === 'Very good') return 'Very good'
  if (c === 'Good') return 'Good'
  return c
}

function fmtPrice(eur) {
  if (!eur && eur !== 0) return '—'
  return '€' + Number(eur).toLocaleString('en-EU', { maximumFractionDigits: 0 })
}

const CATEGORY_ORDER = ['All', 'Watches', 'Jewellery', 'Bags', 'Accessories', 'Shoes']

export default function PreviewCatalog() {
  const [state, setState] = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [meta, setMeta] = useState(null)
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('All')

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
          setProducts(data.products || [])
          setState('ready')
        }
      })
      .catch(() => {
        setState('error')
        setErrorMsg('Failed to load catalog. Please try again or request a new link.')
      })
  }, [token])

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category || 'Other'))
    return ['All', ...CATEGORY_ORDER.slice(1).filter(c => cats.has(c)), ...[...cats].filter(c => !CATEGORY_ORDER.includes(c)).sort()]
  }, [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      const matchCat = filterCategory === 'All' || (p.category || 'Other') === filterCategory
      if (!matchCat) return false
      if (!q) return true
      return [p.brand, p.model, p.reference, p.condition, p.scope_of_delivery]
        .some(f => (f || '').toLowerCase().includes(q))
    })
  }, [products, search, filterCategory])

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

      {/* Header */}
      <div style={{
        background: 'var(--surface, #fff)',
        borderBottom: '1px solid var(--border-light, #e5e7eb)',
        position: 'sticky', top: 0, zIndex: 20,
        padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '0.12em', color: 'var(--gold, #b8965a)', textTransform: 'uppercase' }}>
            Brandville Vault
          </div>
          <div style={{ fontSize: 11, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 1 }}>
            Inventory Preview · Confidential
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {meta?.label && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 1 }}>{meta.label}</div>}
          <div style={{ fontSize: 11, color: 'var(--faint)' }}>
            Valid until {meta?.expires_at ? fmtDate(meta.expires_at) : '—'}
          </div>
        </div>
      </div>

      {/* Search + category bar */}
      <div style={{ background: 'var(--surface, #fff)', borderBottom: '1px solid var(--border-light, #e5e7eb)', padding: '10px 20px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 260 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.35, pointerEvents: 'none' }}>
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30, paddingRight: 10, paddingTop: 7, paddingBottom: 7, border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, fontSize: 13, background: 'var(--surface2, #f5f5f0)', color: 'var(--text)', outline: 'none' }}
          />
        </div>

        {categories.length > 1 && categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            style={{
              padding: '5px 13px', borderRadius: 20, border: 'none', fontSize: 12, cursor: 'pointer',
              background: filterCategory === cat ? 'var(--gold, #b8965a)' : 'var(--surface2, #f3f4f6)',
              color: filterCategory === cat ? '#fff' : 'var(--text-muted, #374151)',
              fontWeight: filterCategory === cat ? 600 : 400,
              transition: 'background 0.1s',
            }}
          >
            {cat}
            {cat !== 'All' && (
              <span style={{ marginLeft: 5, opacity: 0.7, fontSize: 10 }}>
                {products.filter(p => (p.category || 'Other') === cat).length}
              </span>
            )}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--faint)', whiteSpace: 'nowrap' }}>
          {filtered.length}{filtered.length !== products.length ? ` of ${products.length}` : ''} item{products.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1 }}>
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ margin: '48px auto' }}>
            {search || filterCategory !== 'All' ? 'No items match your search.' : 'No available items.'}
          </div>
        ) : (
          <div className="watch-grid">
            {filtered.map(p => (
              <div className="watch-card" key={p.id} style={{ cursor: 'default' }}>
                <div className="card-img-wrap" style={{ cursor: 'default' }}>
                  {p.image_url ? (
                    <img src={p.image_url} alt="" loading="lazy" />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '1/1', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="36" height="36" fill="none" stroke="var(--border-light)" strokeWidth="1.2" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
                        <path d="M12 3v2M12 19v2M3 12h2M19 12h2" strokeLinecap="round"/>
                      </svg>
                    </div>
                  )}
                </div>
                <div className="card-body" style={{ cursor: 'default' }}>
                  <div className="card-brand">{p.brand}</div>
                  <div className="card-model">{p.model}</div>
                  <div className="card-ref">{cleanRef(p.reference) ? `Ref. ${cleanRef(p.reference)}` : '—'}</div>
                  <div className="card-meta">
                    {shortenCond(p.condition) && (
                      <span className="card-cond-pill">{shortenCond(p.condition)}</span>
                    )}
                    {p.scope_of_delivery && (
                      <span className="card-cond-pill" style={{ marginLeft: 4, background: 'var(--surface2)', color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}>
                        {p.scope_of_delivery}
                      </span>
                    )}
                  </div>
                </div>
                <div className="card-price-row">
                  <div className="card-price-block">
                    <div className="card-price">{fmtPrice(p.price_eur)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '16px 24px', textAlign: 'center', fontSize: 11, color: 'var(--faint)', borderTop: '1px solid var(--border-light, #e5e7eb)', background: 'var(--surface, #fff)', lineHeight: 1.8 }}>
        <div>© Brandville Vault — Confidential inventory preview</div>
        <div>This document is generated for verification purposes only and is not to be distributed.</div>
      </div>
    </div>
  )
}
