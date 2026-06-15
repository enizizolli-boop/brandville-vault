import { useNav } from '../hooks/useNav'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'
import Footer from '../components/Footer'
import { useState } from 'react'

const CATEGORIES = [
  {
    key: 'Watches',
    label: 'Watches',
    description: 'Luxury & pre-owned timepieces',
    sub: 'Rolex · Patek · AP · RM',
  },
  {
    key: 'Jewellery',
    label: 'Jewellery',
    description: 'Fine rings, bracelets & necklaces',
    sub: 'Cartier · VCA · Bulgari',
  },
  {
    key: 'Bags',
    label: 'Bags',
    description: 'Designer handbags & accessories',
    sub: 'LV · Chanel · Hermès · Gucci',
  },
]

export default function Home() {
  const navigate = useNav()
  const { profile } = useAuth()
  const [hovered, setHovered] = useState(null)

  function goToCategory(cat) {
    const route = cat === 'Watches' ? '/watches' : cat === 'Jewellery' ? '/jewellery' : '/bags'
    navigate(route)
  }

  const firstName = profile?.full_name?.split(' ')[0] || ''

  return (
    <div className="page">
      <Topbar />

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '64px 24px 56px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, letterSpacing: 3.5, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 18, fontWeight: 600 }}>
          Private Collection
        </div>
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 'clamp(26px, 5vw, 44px)', fontWeight: 400, letterSpacing: 0.3, color: 'var(--text)', marginBottom: 14, lineHeight: 1.2 }}>
          {firstName ? `Welcome, ${firstName}` : 'Welcome'}
        </div>
        <div style={{ width: 40, height: 1, background: 'var(--gold)', margin: '0 auto 18px', opacity: 0.6 }} />
        <div style={{ fontSize: 13, color: 'var(--muted)', letterSpacing: 0.4, maxWidth: 340, margin: '0 auto' }}>
          Authenticated luxury — curated and trusted worldwide
        </div>
      </div>

      {/* Category grid */}
      <div style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: 'clamp(32px, 5vw, 60px) 20px clamp(60px, 8vw, 100px)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 18,
      }}>
        {CATEGORIES.map((cat, i) => (
          <div
            key={cat.key}
            onClick={() => goToCategory(cat.key)}
            onMouseEnter={() => setHovered(cat.key)}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: 'var(--surface)',
              border: hovered === cat.key ? '1.5px solid var(--gold)' : '1px solid var(--border)',
              borderRadius: 14,
              padding: 'clamp(24px, 4vw, 36px) clamp(20px, 3vw, 28px)',
              cursor: 'pointer',
              transition: 'all 0.22s ease',
              transform: hovered === cat.key ? 'translateY(-4px)' : 'none',
              boxShadow: hovered === cat.key ? '0 16px 40px rgba(184,150,90,0.13)' : '0 2px 10px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: 2.5, color: 'var(--gold)', fontWeight: 700, marginBottom: 22, opacity: 0.8 }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 400, color: 'var(--text)', marginBottom: 8, lineHeight: 1.2 }}>
              {cat.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.6 }}>
              {cat.description}
            </div>
            <div style={{ fontSize: 11, color: 'var(--gold)', opacity: 0.7, letterSpacing: 0.3, marginBottom: 24 }}>
              {cat.sub}
            </div>
            <div style={{
              fontSize: 11,
              letterSpacing: 1.8,
              textTransform: 'uppercase',
              color: hovered === cat.key ? 'var(--gold)' : 'var(--muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'color 0.2s',
              fontWeight: 600,
            }}>
              Explore <span style={{ fontSize: 15, letterSpacing: 0 }}>→</span>
            </div>
          </div>
        ))}
      </div>

      {(profile?.role === 'admin' || profile?.role === 'agent') && (
        <div style={{ textAlign: 'center', marginTop: -30, marginBottom: 40 }}>
          <span onClick={() => navigate('/catalog')} style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}>
            View all items
          </span>
        </div>
      )}

      <Footer />
    </div>
  )
}
