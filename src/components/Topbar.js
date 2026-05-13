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

function MobileMenu({ profile, currency, setCurrency, onNavigate, onSignOut, onClose }) {
  const [expanded, setExpanded] = useState(null)

  function go(route, value, type) {
    onClose()
    if (!value) { onNavigate(route); return }
    if (type === 'brand') onNavigate(`${route}?brand=${encodeURIComponent(value)}`)
    else onNavigate(`${route}?type=${encodeURIComponent(value)}`)
  }

  return (
    <div className="mobile-menu-overlay" onClick={onClose}>
      <div className="mobile-menu" onClick={e => e.stopPropagation()}>
        <div className="mobile-menu-header">
          <div className="currency-toggle">
            <button className={`currency-btn ${currency === 'USD' ? 'active' : ''}`} onClick={() => setCurrency('USD')}>USD</button>
            <button className={`currency-btn ${currency === 'EUR' ? 'active' : ''}`} onClick={() => setCurrency('EUR')}>EUR</button>
          </div>
          <button className="mobile-menu-close" onClick={onClose}>✕</button>
        </div>

        {Object.entries(MEGA).map(([cat, data]) => (
          <div key={cat} className="mobile-nav-group">
            <div className="mobile-nav-cat" onClick={() => setExpanded(expanded === cat ? null : cat)}>
              <span>{cat}</span>
              <span style={{ fontSize: 10, color: '#bbb' }}>{expanded === cat ? '▲' : '▼'}</span>
            </div>
            {expanded === cat && (
              <div className="mobile-nav-items">
                <button className="mobile-nav-link mobile-nav-link-all" onClick={() => go(data.route)}>
                  All {cat}
                </button>
                {data.types?.map(t => (
                  <button key={t} className="mobile-nav-link mobile-nav-link-type" onClick={() => go(data.route, t, 'type')}>{t}</button>
                ))}
                {data.cols.flat().map(brand => (
                  <button key={brand} className="mobile-nav-link" onClick={() => go(data.route, brand, 'brand')}>{brand}</button>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="mobile-nav-actions">
          {profile?.role === 'admin' && <button className="btn btn-sm" onClick={() => { onClose(); onNavigate('/admin') }}>Admin</button>}
          {profile?.role !== 'dealer' && <button className="btn btn-sm" onClick={() => { onClose(); onNavigate('/agent') }}>Agent</button>}
          {profile?.role === 'dealer' && <button className="btn btn-sm" onClick={() => { onClose(); onNavigate('/offers') }}>My Offers</button>}
          <button className="btn btn-sm" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}

export default function Topbar() {
  const { profile, signOut } = useAuth()
  const { currency, setCurrency } = useCurrency()
  const navigate = useNavigate()
  const [openMenu, setOpenMenu] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)
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
    <>
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
          <div className="currency-toggle topbar-currency-desktop">
            <button className={`currency-btn ${currency === 'USD' ? 'active' : ''}`} onClick={() => setCurrency('USD')}>USD</button>
            <button className={`currency-btn ${currency === 'EUR' ? 'active' : ''}`} onClick={() => setCurrency('EUR')}>EUR</button>
          </div>
          {profile?.role === 'admin' && (
            <button className="btn btn-sm topbar-btn-desktop" onClick={() => navigate('/admin')}>Admin</button>
          )}
          {profile?.role !== 'dealer' && (
            <button className="btn btn-sm topbar-btn-desktop" onClick={() => navigate('/agent')}>Agent</button>
          )}
          {profile?.role === 'dealer' && (
            <button className="btn btn-sm topbar-btn-desktop" onClick={() => navigate('/offers')}>My Offers</button>
          )}
          <div className="topbar-avatar-wrap">
            <div className={`avatar ${avatarColor(profile?.full_name)}`}>{initials(profile?.full_name)}</div>
            <span className="user-name-label" style={{ fontSize: 12, color: '#888' }}>{profile?.full_name}</span>
          </div>
          <button className="btn btn-sm topbar-btn-desktop" onClick={handleSignOut}>Sign out</button>
          <button className="hamburger" onClick={() => setMobileOpen(true)} aria-label="Menu">
            <span /><span /><span />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <MobileMenu
          profile={profile}
          currency={currency}
          setCurrency={setCurrency}
          onNavigate={navigate}
          onSignOut={() => { setMobileOpen(false); handleSignOut() }}
          onClose={() => setMobileOpen(false)}
        />
      )}
    </>
  )
}
