import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'
import Footer from '../components/Footer'
import { useState } from 'react'

const CATEGORIES = [
  {
    key: 'Watches',
    label: 'Watches',
    emoji: '⌚',
    description: 'Luxury & pre-owned timepieces',
    color: '#1a1a1a',
    bg: '#f7f6f3',
  },
  {
    key: 'Jewellery',
    label: 'Jewellery',
    emoji: '💎',
    description: 'Fine rings, bracelets & necklaces',
    color: '#1a1a1a',
    bg: '#f0ede8',
  },
  {
    key: 'Bags',
    label: 'Bags',
    emoji: '👜',
    description: 'Designer handbags & accessories',
    color: '#1a1a1a',
    bg: '#ece8e2',
  },
]

export default function Home() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [hovered, setHovered] = useState(null)

  function goToCategory(cat) {
    const route = cat === 'Watches' ? '/watches' : cat === 'Jewellery' ? '/jewellery' : '/bags'
    navigate(route)
  }

  return (
    <div className="page">
      <Topbar />
      <div style={{
        maxWidth: 680,
        margin: '0 auto',
        padding: '40px 16px 60px',
      }}>
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: 'uppercase', color: '#b8b0a5', marginBottom: 10, fontWeight: 600 }}>
            Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
          </div>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, fontWeight: 400, letterSpacing: 0.2, color: 'var(--text)' }}>
            What are you looking for?
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {CATEGORIES.map(cat => (
            <div
              key={cat.key}
              onClick={() => goToCategory(cat.key)}
              onMouseEnter={() => setHovered(cat.key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: 'var(--surface)',
                border: hovered === cat.key ? '1px solid var(--gold)' : '1px solid var(--border)',
                borderRadius: 16,
                padding: '22px 24px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                transition: 'all 0.2s ease',
                transform: hovered === cat.key ? 'translateY(-2px)' : 'none',
                boxShadow: hovered === cat.key ? '0 8px 28px rgba(0,0,0,0.4)' : 'none',
              }}
            >
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: 'var(--gold-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                flexShrink: 0,
                border: '1px solid rgba(184,150,106,0.25)',
              }}>
                {cat.emoji}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 3, color: 'var(--text)' }}>{cat.label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{cat.description}</div>
              </div>
              <div style={{ fontSize: 18, color: hovered === cat.key ? 'var(--gold)' : 'var(--faint)' }}>›</div>
            </div>
          ))}
        </div>

        {(profile?.role === 'admin' || profile?.role === 'agent') && (
          <div
            onClick={() => navigate('/catalog')}
            style={{
              marginTop: 20,
              textAlign: 'center',
              fontSize: 13,
              color: '#b8b0a5',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            View all items
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}
