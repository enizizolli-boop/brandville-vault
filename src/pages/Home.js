import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'
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
    navigate(`/catalog?category=${cat}`)
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
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#aaa', marginBottom: 8 }}>
            Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.5 }}>
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
                background: hovered === cat.key ? '#f0ede8' : '#fff',
                border: '1px solid #e8e5e0',
                borderRadius: 16,
                padding: '24px 28px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                transition: 'all 0.15s ease',
                transform: hovered === cat.key ? 'translateY(-1px)' : 'none',
                boxShadow: hovered === cat.key ? '0 4px 16px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: cat.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                flexShrink: 0,
                border: '1px solid #e8e5e0',
              }}>
                {cat.emoji}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 3 }}>{cat.label}</div>
                <div style={{ fontSize: 13, color: '#999' }}>{cat.description}</div>
              </div>
              <div style={{ fontSize: 20, color: '#ccc' }}>›</div>
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
              color: '#aaa',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            View all items
          </div>
        )}
      </div>
    </div>
  )
}
