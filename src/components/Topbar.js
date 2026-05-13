import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCurrency } from '../context/CurrencyContext'

const AVATAR_COLORS = ['avatar-blue', 'avatar-green', 'avatar-amber', 'avatar-purple', 'avatar-red']

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
function avatarColor(name = '') {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

const MEGA = {
  Watches: {
    route: '/watches',
    cols: [
      ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin'],
      ['Omega', 'Cartier', 'IWC', 'Jaeger-LeCoultre', 'A. Lange & Söhne'],
      ['Hublot', 'Breitling', 'Panerai', 'TAG Heuer', 'Tudor'],
    ],
  },
  Jewellery: {
    route: '/jewellery',
    cols: [
      ['Cartier', 'Van Cleef & Arpels', 'Bulgari', 'Tiffany & Co', 'Harry Winston'],
      ['Chanel', 'Dior', 'Graff', 'De Beers', 'Mikimoto'],
    ],
    types: ['Rings', 'Necklaces', 'Bracelets', 'Earrings'],
  },
  Bags: {
    route: '/bags',
    cols: [
      ['Louis Vuitton', 'Chanel', 'Hermès', 'Gucci', 'Dior'],
      ['Prada', 'Balenciaga', 'Bottega Veneta', 'Saint Laurent', 'Fendi'],
    ],
    types: ['Bags', 'Accessories', 'Shoes'],
  },
}

function MegaMenu({ category, data, onNavigate, onClose }) {
  return (
    <div className="mega-menu" onMouseLeave={onClose}>
      <div className="mega-inner">
        {data.types && (
          <div className="mega-section">
            <div className="mega-heading">Categories</div>
            {data.types.map(t => (
              <button key={t} className="mega-link mega-link-type"
                onClick={() => onNavigate(data.route, t, 'type')}>
                {t}
              </button>
            ))}
          </div>
        )}
        {data.cols.map((col, ci) => (
          <div key={ci} className="mega-section">
            {ci === 0 && <div className="mega-heading">Brands</div>}
            {ci > 0 && <div className="mega-heading" style={{ opacity: 0 }}>·</div>}
            {col.map(brand => (
              <button key={brand} className="mega-link"
                onClick={() => onNavigate(data.route, brand, 'brand')}>
                {brand}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="mega-footer">
        <button className="mega-view-all" onClick={() => { onNavigate(data.route); onClose() }}>
          View all {category} →
        </button>
      </div>
    </div>
  )
}

export default function Topbar() {
  const { profile, signOut } = useAuth()
  const { currency, setCurrency } = useCurrency()
  const navigate = useNavigate()
  const [openMenu, setOpenMenu] = useState(null)
  const closeTimer = useRef(null)

  function handleSignOut() {
    signOut().then(() => navigate('/login'))
  }

  function openNav(cat) {
    clearTimeout(closeTimer.current)
    setOpenMenu(cat)
  }

  function closeNav() {
    closeTimer.current = setTimeout(() => setOpenMenu(null), 120)
  }

  function handleMegaNavigate(route, value, type) {
    setOpenMenu(null)
    if (!value) { navigate(route); return }
    if (type === 'brand') navigate(`${route}?brand=${encodeURIComponent(value)}`)
    else navigate(`${route}?type=${encodeURIComponent(value)}`)
  }

  return (
    <div className="topbar">
      <div className="topbar-logo" onClick={() => navigate('/home')} style={{ cursor: 'pointer' }}>
        Brandville <span>Vault</span>
      </div>

      <nav className="topbar-nav">
        {Object.entries(MEGA).map(([cat, data]) => (
          <div key={cat} className="nav-item"
            onMouseEnter={() => openNav(cat)}
            onMouseLeave={closeNav}>
            <button className={`nav-link ${openMenu === cat ? 'active' : ''}`}
              onClick={() => navigate(data.route)}>
              {cat}
            </button>
            {openMenu === cat && (
              <MegaMenu
                category={cat}
                data={data}
                onNavigate={handleMegaNavigate}
                onClose={() => setOpenMenu(null)}
              />
            )}
          </div>
        ))}
      </nav>

      <div className="topbar-right">
        <div className="currency-toggle">
          <button className={`currency-btn ${currency === 'USD' ? 'active' : ''}`} onClick={() => setCurrency('USD')}>USD</button>
          <button className={`currency-btn ${currency === 'EUR' ? 'active' : ''}`} onClick={() => setCurrency('EUR')}>EUR</button>
        </div>
        {profile?.role === 'admin' && (
          <button className="btn btn-sm" onClick={() => navigate('/admin')}>Admin</button>
        )}
        {profile?.role !== 'dealer' && (
          <button className="btn btn-sm" onClick={() => navigate('/agent')}>Agent</button>
        )}
        {profile?.role === 'dealer' && (
          <button className="btn btn-sm" onClick={() => navigate('/offers')}>My Offers</button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div className={`avatar ${avatarColor(profile?.full_name)}`}>{initials(profile?.full_name)}</div>
          <span className="user-name-label" style={{ fontSize: 12, color: '#888' }}>{profile?.full_name}</span>
        </div>
        <button className="btn btn-sm" onClick={handleSignOut}>Sign out</button>
      </div>
    </div>
  )
}
