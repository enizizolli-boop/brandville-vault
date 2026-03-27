import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const AVATAR_COLORS = ['avatar-blue', 'avatar-green', 'avatar-amber', 'avatar-purple', 'avatar-red']

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function avatarColor(name = '') {
  const i = name.charCodeAt(0) % AVATAR_COLORS.length
  return AVATAR_COLORS[i]
}

export default function Topbar({ currency, onCurrencyChange }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="topbar">
      <div className="topbar-logo">
        Brandville <span>Vault</span>
      </div>
      <div className="topbar-right">
        {onCurrencyChange && (
          <div className="currency-toggle">
            <button className={`currency-btn ${currency === 'USD' ? 'active' : ''}`} onClick={() => onCurrencyChange('USD')}>USD</button>
            <button className={`currency-btn ${currency === 'EUR' ? 'active' : ''}`} onClick={() => onCurrencyChange('EUR')}>EUR</button>
          </div>
        )}
        {profile?.role === 'admin' && (
          <button className="btn btn-sm" onClick={() => navigate('/admin')}>Admin</button>
        )}
        {profile?.role !== 'dealer' && (
          <button className="btn btn-sm" onClick={() => navigate('/agent')}>Agent</button>
        )}
        {profile?.role !== 'agent' && (
          <button className="btn btn-sm" onClick={() => navigate('/catalog')}>Catalog</button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className={`avatar ${avatarColor(profile?.full_name)}`}>{initials(profile?.full_name)}</div>
          <span style={{ fontSize: 12, color: '#888' }}>{profile?.full_name}</span>
        </div>
        <button className="btn btn-sm" onClick={handleSignOut}>Sign out</button>
      </div>
    </div>
  )
}
