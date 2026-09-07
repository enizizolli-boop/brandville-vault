import { useState, useEffect, useMemo } from 'react'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

function fmtPrice(eur) {
  if (!eur && eur !== 0) return '—'
  return new Intl.NumberFormat('en-EU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(eur)
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function PreviewCatalog() {
  const [state, setState] = useState('loading') // loading | error | ready
  const [errorMsg, setErrorMsg] = useState('')
  const [meta, setMeta] = useState(null) // { label, expires_at }
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
    return ['All', ...Array.from(cats).sort()]
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
      <div style={styles.fullCenter}>
        <div style={styles.spinner} />
        <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 14 }}>Loading catalog…</div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div style={styles.fullCenter}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8, color: '#111' }}>Link unavailable</div>
        <div style={{ color: '#6b7280', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>{errorMsg}</div>
        <div style={{ marginTop: 24, fontSize: 12, color: '#9ca3af' }}>Brandville Vault · Private Catalog</div>
      </div>
    )
  }

  return (
    <>
      {/* noindex injected via Helmet would be ideal, but a meta tag via document works for static access */}
      <meta name="robots" content="noindex, nofollow" />

      <div style={styles.page}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <div>
              <div style={styles.brand}>BRANDVILLE VAULT</div>
              <div style={styles.headerSub}>Inventory Preview · Confidential</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {meta?.label && (
                <div style={{ fontWeight: 600, fontSize: 13, color: '#111', marginBottom: 2 }}>{meta.label}</div>
              )}
              <div style={{ fontSize: 12, color: '#9ca3af' }}>
                Valid until {meta?.expires_at ? fmtDate(meta.expires_at) : '—'}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                {filtered.length !== products.length
                  ? `${filtered.length} of ${products.length} items shown`
                  : `${products.length} available item${products.length !== 1 ? 's' : ''}`}
              </div>
            </div>
          </div>
        </header>

        {/* Controls */}
        <div style={styles.controls}>
          <div style={styles.controlsInner}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 380 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', opacity: 0.35, pointerEvents: 'none' }}>
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search brand, model, reference…"
                style={styles.searchInput}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  style={{
                    ...styles.catBtn,
                    background: filterCategory === cat ? '#b8965a' : '#f3f4f6',
                    color: filterCategory === cat ? '#fff' : '#374151',
                    fontWeight: filterCategory === cat ? 600 : 400,
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={styles.tableWrap}>
          <div style={styles.tableInner}>
            {filtered.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                {search || filterCategory !== 'All' ? 'No items match your search.' : 'No available items.'}
              </div>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, width: 56 }}></th>
                    <th style={styles.th}>Brand</th>
                    <th style={styles.th}>Model</th>
                    <th style={styles.th}>Reference</th>
                    <th style={styles.th}>Condition</th>
                    <th style={styles.th}>Scope</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Price (EUR)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={p.id} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={styles.td}>
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            loading="lazy"
                            style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, display: 'block', background: '#f3f4f6' }}
                          />
                        ) : (
                          <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="20" height="20" fill="none" stroke="#d1d5db" strokeWidth="1.5" viewBox="0 0 24 24">
                              <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
                              <path d="M12 3v2M12 19v2M3 12h2M19 12h2" strokeLinecap="round"/>
                            </svg>
                          </div>
                        )}
                      </td>
                      <td style={{ ...styles.td, fontWeight: 600, whiteSpace: 'nowrap' }}>{p.brand || '—'}</td>
                      <td style={styles.td}>{p.model || '—'}</td>
                      <td style={{ ...styles.td, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{p.reference || '—'}</td>
                      <td style={styles.td}>
                        {p.condition ? (
                          <span style={styles.condPill}>{p.condition}</span>
                        ) : '—'}
                      </td>
                      <td style={{ ...styles.td, color: '#6b7280', fontSize: 12 }}>{p.scope_of_delivery || '—'}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {fmtPrice(p.price_eur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer style={styles.footer}>
          <div>© Brandville Vault — Confidential inventory preview</div>
          <div>This document is generated for verification purposes only and is not to be distributed.</div>
        </footer>
      </div>

      <style>{`
        @keyframes bv-spin { to { transform: rotate(360deg) } }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111; }
        table { border-collapse: collapse; }
        @media (max-width: 600px) {
          .bv-hide-mobile { display: none !important; }
        }
      `}</style>
    </>
  )
}

const styles = {
  fullCenter: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f9fafb',
    padding: 24,
  },
  spinner: {
    width: 28,
    height: 28,
    border: '2.5px solid #e5e7eb',
    borderTop: '2.5px solid #b8965a',
    borderRadius: '50%',
    animation: 'bv-spin 0.7s linear infinite',
  },
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#f9fafb',
  },
  header: {
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '18px 0',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerInner: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  brand: {
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: '0.12em',
    color: '#b8965a',
  },
  headerSub: {
    fontSize: 11,
    color: '#9ca3af',
    letterSpacing: '0.06em',
    marginTop: 2,
  },
  controls: {
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '12px 0',
  },
  controlsInner: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '0 24px',
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  searchInput: {
    width: '100%',
    padding: '8px 12px 8px 34px',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    fontSize: 14,
    background: '#f9fafb',
    color: '#111',
    outline: 'none',
  },
  catBtn: {
    padding: '5px 12px',
    borderRadius: 20,
    border: 'none',
    fontSize: 12,
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  tableWrap: {
    flex: 1,
    padding: '24px',
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
    overflowX: 'auto',
  },
  tableInner: {
    background: '#fff',
    borderRadius: 14,
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    fontSize: 13,
  },
  th: {
    padding: '11px 14px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#6b7280',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 14px',
    borderBottom: '1px solid #f3f4f6',
    verticalAlign: 'middle',
    fontSize: 13,
  },
  condPill: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 20,
    background: '#f3f4f6',
    fontSize: 11,
    fontWeight: 600,
    color: '#374151',
    whiteSpace: 'nowrap',
  },
  footer: {
    padding: '16px 24px',
    textAlign: 'center',
    fontSize: 11,
    color: '#9ca3af',
    borderTop: '1px solid #e5e7eb',
    background: '#fff',
    lineHeight: 1.8,
  },
}
