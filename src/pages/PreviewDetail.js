import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Footer from '../components/Footer'

const WA_NUMBER = '18488639660' // Watches

const WA_SVG = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
)

function cleanRef(ref) {
  if (!ref) return ''
  if (ref.includes('/')) return ref.split('/').filter(Boolean).pop()
  const n = ref.match(/(\d+)$/)
  if (n) return n[1]
  return ref
}

function fmtPrice(eur) {
  if (!eur && eur !== 0) return '—'
  return '€' + Number(eur).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function PreviewDetail() {
  const navigate = useNavigate()
  const [activeImg, setActiveImg] = useState(0)
  const [lightbox, setLightbox] = useState(null)
  const [shared, setShared] = useState(false)

  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), [])

  const product = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem('bv-preview-product') || 'null') } catch { return null }
  }, [])

  const images = useMemo(() => product?.images || (product?.image_url ? [product.image_url] : []), [product])

  useEffect(() => { setActiveImg(0) }, [product])

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

  function goBack() { navigate(token ? `/preview?token=${token}` : '/preview') }

  function handleWhatsApp() {
    const msg = encodeURIComponent(`Hi, I'm interested in the ${product.brand} ${product.model}${cleanRef(product.reference) ? ` Ref. ${cleanRef(product.reference)}` : ''} listed on Brandville Vault.`)
    window.open(`https://wa.me/${WA_NUMBER}?text=${msg}`, '_blank', 'noopener')
  }

  function handleShare() {
    const url = window.location.href
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => { setShared(true); setTimeout(() => setShared(false), 2000) })
    }
  }

  if (!product) {
    return (
      <div className="page" style={{ background: '#ffffff' }}>
        <div className="topbar">
          <div className="topbar-logo" style={{ cursor: 'default' }}>Brandville <span>Vault</span></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 120px)', padding: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Product not found</div>
          <div style={{ color: 'var(--faint)', fontSize: 14, marginBottom: 20 }}>Please go back and click a watch again.</div>
          <button className="btn btn-sm" onClick={goBack}>← Back</button>
        </div>
        <Footer />
      </div>
    )
  }

  // Suppress Zoho auto-generated notes
  let displayNotes = product.notes || null
  if (displayNotes && /^\d+\s*-\s*\S/.test(displayNotes.trim())) displayNotes = null
  if (displayNotes) {
    const lower = displayNotes.toLowerCase()
    const hasCondition = product.condition && lower.includes(product.condition.toLowerCase())
    const hasScope = product.scope_of_delivery && lower.includes(product.scope_of_delivery.toLowerCase())
    if (hasCondition && hasScope) displayNotes = null
  }

  return (
    <div className="page" style={{ background: '#ffffff' }}>

      {/* Header — same structure as WatchDetail but no nav */}
      <div className="topbar">
        <div className="topbar-logo" style={{ cursor: 'default' }}>Brandville <span>Vault</span></div>
      </div>

      {/* Back bar */}
      <div style={{ maxWidth: 940, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px' }}>
        <button className="btn btn-sm" onClick={goBack}>← Back</button>
      </div>

      {/* 2-column layout */}
      <div className="detail-layout">

        {/* LEFT — images */}
        <div className="detail-left">
          <div style={{
            position: 'relative', background: '#f5f2ed', borderRadius: 16, overflow: 'hidden',
            aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                <div key={i} style={{ position: 'relative' }}>
                  <img
                    src={url}
                    alt=""
                    onClick={() => setActiveImg(i)}
                    style={{
                      width: 72, height: 72, objectFit: 'cover', borderRadius: 10,
                      border: i === activeImg ? '2px solid #b8965a' : '2px solid transparent',
                      outline: i === activeImg ? 'none' : '1px solid var(--border)',
                      cursor: 'pointer', transition: 'border-color 0.15s', display: 'block',
                    }}
                  />
                  {i === 0 && (
                    <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
                      <span style={{ background: '#b8965a', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em' }}>MAIN</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — info, identical to WatchDetail */}
        <div className="detail-right">
          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <div className="detail-category">{product.category || 'Watches'}</div>
            <div className="detail-brand">
              {product.brand}
            </div>
            <div className="detail-model">{product.model}</div>
            {(cleanRef(product.reference) || product.reference) && (
              <div className="detail-ref">
                <span className="detail-ref-label">Ref</span>
                {cleanRef(product.reference) || product.reference}
              </div>
            )}
          </div>

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#16a34a' }}>Available</span>
          </div>

          {/* Price */}
          <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border-light)' }}>
            <div className="detail-price">{fmtPrice(product.price_eur)}</div>
          </div>

          {/* Specs */}
          <div className="detail-meta" style={{ marginBottom: 24 }}>
            <div className="detail-meta-row">
              <span className="detail-meta-key">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Condition
              </span>
              <span>{product.condition || '—'}</span>
            </div>
            {product.scope_of_delivery && (
              <div className="detail-meta-row">
                <span className="detail-meta-key">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  Scope of delivery
                </span>
                <span>{product.scope_of_delivery}</span>
              </div>
            )}
            {displayNotes && (
              <div className="detail-meta-row">
                <span className="detail-meta-key">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  Notes
                </span>
                <span>{displayNotes}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="detail-actions" style={{ marginBottom: 14 }}>
            <button className="btn btn-green detail-btn-icon" onClick={handleWhatsApp}>
              {WA_SVG}
              WhatsApp
            </button>
            <button className="btn detail-btn-icon" onClick={handleShare}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              {shared ? 'Copied!' : 'Share'}
            </button>
          </div>

          {/* Authenticity banner */}
          <div className="detail-auth-banner">
            <div className="detail-auth-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <div className="detail-auth-title">Authenticity guaranteed</div>
              <div className="detail-auth-sub">All items are authenticated and inspected by our specialists.</div>
            </div>
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
