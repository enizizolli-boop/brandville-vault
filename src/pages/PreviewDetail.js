import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/Topbar'
import Footer from '../components/Footer'

function cleanRef(ref) {
  if (!ref) return ''
  if (ref.includes('/')) return ref.split('/').filter(Boolean).pop()
  const n = ref.match(/(\d+)$/)
  if (n) return n[1]
  return ref
}

function fmtPrice(eur) {
  if (!eur && eur !== 0) return '—'
  return '€' + Number(eur).toLocaleString('en-EU', { maximumFractionDigits: 0 })
}

export default function PreviewDetail() {
  const navigate = useNavigate()
  const [activeImg, setActiveImg] = useState(0)
  const [lightbox, setLightbox] = useState(null)

  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), [])

  // Read product from sessionStorage (set by PreviewCatalog on card click)
  const product = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem('bv-preview-product') || 'null') } catch { return null }
  }, [])

  const images = useMemo(() => product?.images || (product?.image_url ? [product.image_url] : []), [product])

  useEffect(() => {
    setActiveImg(0)
  }, [product])

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

  function goBack() {
    navigate(token ? `/preview?token=${token}` : '/preview')
  }

  if (!product) {
    return (
      <div className="page">
        <Topbar />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 120px)', padding: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Product not found</div>
          <div style={{ color: 'var(--faint)', fontSize: 14, marginBottom: 20 }}>Please go back and click a watch again.</div>
          <button className="btn" onClick={goBack}>← Back to catalog</button>
        </div>
        <Footer />
      </div>
    )
  }

  const metaRows = [
    { label: 'Reference', value: cleanRef(product.reference) || '—' },
    { label: 'Condition', value: product.condition || '—' },
    { label: 'Scope of delivery', value: product.scope_of_delivery || '—' },
    product.notes ? { label: 'Notes', value: product.notes } : null,
  ].filter(Boolean)

  return (
    <div className="page">
      <Topbar />

      {/* Back button */}
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '16px 20px 0' }}>
        <button
          onClick={goBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--faint)', padding: 0 }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back to catalog
        </button>
      </div>

      {/* 2-column detail layout */}
      <div className="detail-layout">

        {/* LEFT — images */}
        <div className="detail-left">
          <div style={{
            position: 'relative', background: '#f5f2ed', borderRadius: 16,
            overflow: 'hidden', aspectRatio: '1/1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
          }}>
            {images.length > 0 ? (
              <>
                <img
                  src={images[activeImg]}
                  alt={product.model}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'zoom-in' }}
                  onClick={() => setLightbox(activeImg)}
                />
                {images.length > 1 && activeImg > 0 && (
                  <button onClick={() => setActiveImg(i => Math.max(i - 1, 0))}
                    style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: '#fff', border: 'none', boxShadow: '0 2px 14px rgba(0,0,0,0.14)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#333', zIndex: 2, lineHeight: 1 }}>‹</button>
                )}
                {images.length > 1 && activeImg < images.length - 1 && (
                  <button onClick={() => setActiveImg(i => Math.min(i + 1, images.length - 1))}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: '#fff', border: 'none', boxShadow: '0 2px 14px rgba(0,0,0,0.14)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#333', zIndex: 2, lineHeight: 1 }}>›</button>
                )}
                {images.length > 1 && (
                  <div style={{ position: 'absolute', bottom: 14, display: 'flex', gap: 6 }}>
                    {images.map((_, i) => (
                      <div key={i} onClick={() => setActiveImg(i)}
                        style={{ width: 7, height: 7, borderRadius: '50%', background: i === activeImg ? '#b8965a' : 'rgba(0,0,0,0.18)', cursor: 'pointer', transition: 'background 0.15s' }} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <svg width="60" height="60" fill="none" stroke="var(--border-light)" strokeWidth="1" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
                  <path d="M12 3v2M12 19v2M3 12h2M19 12h2" strokeLinecap="round"/>
                </svg>
              </div>
            )}
          </div>

          {/* Thumbnails */}
          {images.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {images.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt=""
                  onClick={() => setActiveImg(i)}
                  style={{
                    width: 72, height: 72, objectFit: 'cover', borderRadius: 10,
                    border: i === activeImg ? '2px solid #b8965a' : '2px solid transparent',
                    outline: i === activeImg ? 'none' : '1px solid var(--border)',
                    cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — info */}
        <div className="detail-right">
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>
            {product.brand}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', lineHeight: 1.2 }}>{product.model}</h1>
          {cleanRef(product.reference) && (
            <div style={{ fontSize: 14, color: 'var(--faint)', marginBottom: 20 }}>Ref. {cleanRef(product.reference)}</div>
          )}

          {/* Price */}
          <div style={{ marginBottom: 24 }}>
            <div className="detail-price">{fmtPrice(product.price_eur)}</div>
          </div>

          {/* Meta table */}
          <div className="detail-meta" style={{ marginBottom: 28 }}>
            {metaRows.map(row => (
              <div key={row.label} className="detail-meta-row">
                <span className="detail-meta-label">{row.label}</span>
                <span className="detail-meta-value">{row.value}</span>
              </div>
            ))}
          </div>

          {/* Confidential notice */}
          <div style={{ padding: '12px 14px', background: 'var(--surface2)', borderRadius: 10, fontSize: 12, color: 'var(--faint)', lineHeight: 1.6 }}>
            This catalog is for verification purposes only and is not to be distributed.
          </div>
        </div>
      </div>

      <Footer />

      {/* Lightbox */}
      {lightbox !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.93)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 20, right: 24, background: 'none', border: 'none', color: '#fff', fontSize: 36, cursor: 'pointer', lineHeight: 1 }}>×</button>
          {images.length > 1 && lightbox > 0 && (
            <button onClick={e => { e.stopPropagation(); setLightbox(i => i - 1) }} style={{ position: 'absolute', left: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 28, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer' }}>‹</button>
          )}
          <img src={images[lightbox]} alt={product.model} style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
          {images.length > 1 && lightbox < images.length - 1 && (
            <button onClick={e => { e.stopPropagation(); setLightbox(i => i + 1) }} style={{ position: 'absolute', right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 28, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer' }}>›</button>
          )}
          {images.length > 1 && (
            <div style={{ position: 'absolute', bottom: 24, display: 'flex', gap: 7 }}>
              {images.map((_, i) => (
                <div key={i} onClick={e => { e.stopPropagation(); setLightbox(i) }}
                  style={{ width: 8, height: 8, borderRadius: '50%', background: i === lightbox ? '#b8965a' : 'rgba(255,255,255,0.35)', cursor: 'pointer', transition: 'background 0.15s' }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
