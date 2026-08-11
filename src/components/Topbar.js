import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCurrency } from '../context/CurrencyContext'
import { useNav } from '../hooks/useNav'
import { supabase } from '../lib/supabase'

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

const NAV = [
  { label: 'All Products', route: '/catalog' },
  { label: 'Watches', route: '/watches', mega: 'Watches' },
  { label: 'Jewellery', route: '/jewellery', mega: 'Jewellery' },
  { label: 'Bags', route: '/bags', mega: 'Bags' },
]

function MegaMenu({ category, data, onNavigate, onClose, onKeepOpen }) {
  return (
    <div className="mega-menu" onMouseLeave={onClose} onMouseEnter={onKeepOpen}>
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
  const isSupplier = profile?.role === 'supplier'

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
          {!isSupplier && (
            <div className="currency-toggle">
              <button className={`currency-btn ${currency === 'USD' ? 'active' : ''}`} onClick={() => setCurrency('USD')}>USD</button>
              <button className={`currency-btn ${currency === 'EUR' ? 'active' : ''}`} onClick={() => setCurrency('EUR')}>EUR</button>
            </div>
          )}
          <button className="mobile-menu-close" onClick={onClose}>✕</button>
        </div>

        {!isSupplier && Object.entries(MEGA).map(([cat, data]) => (
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
          {profile?.role === 'dealer' && <button className="btn btn-sm" onClick={() => { onClose(); onNavigate('/offers') }}>My Offers</button>}
          {(profile?.role === 'agent' || profile?.role === 'admin') && <button className="btn btn-sm" onClick={() => { onClose(); onNavigate('/agent') }}>Agent Panel</button>}
          <button className="btn btn-sm" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}

export default function Topbar() {
  const { profile, signOut } = useAuth()
  const { currency, setCurrency } = useCurrency()
  const navigate = useNav()
  const location = useLocation()
  const [openMenu, setOpenMenu] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const closeTimer = useRef(null)
  const isSupplier = profile?.role === 'supplier'

  useEffect(() => {
    if (!profile) return
    async function fetchCount() {
      let total = 0
      if (profile.role === 'dealer') {
        const { count } = await supabase
          .from('offers').select('id', { count: 'exact', head: true })
          .eq('dealer_id', profile.id).eq('status', 'countered')
        total = count || 0
      } else if (profile.role === 'agent' || profile.role === 'admin') {
        const [{ count: sup }, { count: off }] = await Promise.all([
          supabase.from('supplier_listings').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
          supabase.from('offers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        ])
        total = (sup || 0) + (off || 0)
      }
      setNotifCount(total)
    }
    fetchCount()
    const ch = supabase.channel('topbar-notif')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, fetchCount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_listings' }, fetchCount)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [profile])

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

  function isActive(route) {
    if (route === '/catalog' || route === '/catalog?tab=new') return location.pathname === '/catalog'
    return location.pathname.startsWith(route.split('?')[0])
  }

  return (
    <>
      <div className="topbar">
        <a href="/home" className="topbar-logo" onClick={e => { e.preventDefault(); navigate(isSupplier ? '/supplier' : '/home') }}>
          Brandville <span>Vault</span>
        </a>

        {!isSupplier && (
          <nav className="topbar-nav">
            {NAV.map(item => (
              <div key={item.label} className="nav-item"
                onMouseEnter={() => item.mega ? openNav(item.mega) : clearTimeout(closeTimer.current)}
                onMouseLeave={item.mega ? closeNav : undefined}>
                <a
                  href={item.route}
                  className={`nav-link ${isActive(item.route) ? 'active' : ''}`}
                  onClick={e => { e.preventDefault(); setOpenMenu(null); navigate(item.route) }}
                >
                  {item.label}
                </a>
                {item.mega && openMenu === item.mega && (
                  <MegaMenu
                    category={item.mega}
                    data={MEGA[item.mega]}
                    onNavigate={handleMegaNavigate}
                    onClose={() => setOpenMenu(null)}
                    onKeepOpen={() => openNav(item.mega)}
                  />
                )}
              </div>
            ))}
          </nav>
        )}

        <div className="topbar-right">
          {!isSupplier && (
            <button className="topbar-icon-btn" title="Region">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <svg width="8" height="8" fill="currentColor" viewBox="0 0 8 8"><path d="M1 2l3 4 3-4z"/></svg>
            </button>
          )}

          {!isSupplier && (
            <div className="topbar-currency-select topbar-btn-desktop">
              <select value={currency} onChange={e => setCurrency(e.target.value)} className="topbar-curr-sel">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
              <svg width="8" height="8" fill="currentColor" viewBox="0 0 8 8" className="curr-chevron"><path d="M1 2l3 4 3-4z"/></svg>
            </div>
          )}

          {!isSupplier && (
            <button
              className="topbar-icon-btn topbar-btn-desktop"
              title="Notifications"
              onClick={() => navigate(profile?.role === 'dealer' ? '/offers' : '/agent')}
              style={{ position: 'relative' }}
            >
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {notifCount > 0 && (
                <span style={{
                  position: 'absolute', top: -5, right: -5,
                  background: '#ef4444', color: '#fff',
                  borderRadius: '50%', minWidth: 16, height: 16,
                  fontSize: 9, fontWeight: 700, lineHeight: '16px',
                  textAlign: 'center', padding: '0 3px',
                  boxSizing: 'border-box',
                }}>
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
          )}

          <div className="topbar-account-widget topbar-btn-desktop" onClick={() => navigate('/account')} title="My Account">
            <div className={`avatar ${avatarColor(profile?.full_name)}`}>
              {initials(profile?.full_name)}
            </div>
            <div className="ta-info">
              <div className="ta-name">{profile?.full_name?.split(' ')[0] || 'Account'}</div>
            </div>
          </div>

          {isSupplier && (
            <button className="btn btn-sm topbar-btn-desktop" onClick={handleSignOut}
              style={{ fontSize: 11, padding: '5px 10px' }}>Sign out</button>
          )}

          {(profile?.role === 'agent' || profile?.role === 'admin') && (
            <button className="btn btn-sm topbar-btn-desktop" onClick={() => navigate('/agent')}
              style={{ fontSize: 11, padding: '5px 10px' }}>Agent Panel</button>
          )}
          {profile?.role === 'admin' && (
            <button className="btn btn-sm topbar-btn-desktop" onClick={() => navigate('/admin')}
              style={{ fontSize: 11, padding: '5px 10px' }}>Admin</button>
          )}

          {!isSupplier && (
            <button className="hamburger" onClick={() => setMobileOpen(true)} aria-label="Menu">
              <span /><span /><span />
            </button>
          )}
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
