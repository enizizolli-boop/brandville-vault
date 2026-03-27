import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Topbar from '../components/Topbar'

const AVATAR_COLORS = ['avatar-blue', 'avatar-green', 'avatar-amber', 'avatar-purple', 'avatar-red']
function initials(name = '') { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() }
function avatarColor(name = '') { return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length] }

export default function AdminPanel() {
  const [tab, setTab] = useState('dealers')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('dealer')
  const [inviting, setInviting] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [stats, setStats] = useState({ total: 0, available: 0, reserved: 0, sold: 0 })

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers(data || [])
    setLoading(false)
  }, [])

  const fetchStats = useCallback(async () => {
    const { data } = await supabase.from('watches').select('status')
    if (data) {
      setStats({
        total: data.length,
        available: data.filter(w => w.status === 'available').length,
        reserved: data.filter(w => w.status === 'reserved').length,
        sold: data.filter(w => w.status === 'sold').length,
      })
    }
  }, [])

  useEffect(() => { fetchUsers(); fetchStats() }, [fetchUsers, fetchStats])

  async function handleInvite(e) {
    e.preventDefault()
    setError(''); setMsg('')
    if (!inviteEmail) return
    setInviting(true)
    const { error: invErr } = await supabase.auth.admin?.inviteUserByEmail
      ? supabase.auth.admin.inviteUserByEmail(inviteEmail, { data: { role: inviteRole } })
      : { error: null }

    const { error: dbErr } = await supabase.from('invites').insert({ email: inviteEmail, role: inviteRole })
    if (dbErr && dbErr.code !== '23505') {
      setError('Could not record invite. User may already be invited.')
    } else {
      setMsg(`Invite sent to ${inviteEmail} as ${inviteRole}. They'll receive an email to set their password.`)
      setInviteEmail('')
    }
    setInviting(false)
  }

  async function changeRole(userId, newRole) {
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    fetchUsers()
  }

  const dealers = users.filter(u => u.role === 'dealer')
  const agents = users.filter(u => u.role === 'agent')

  return (
    <div className="page">
      <Topbar />
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat-card"><div className="stat-val">{stats.total}</div><div className="stat-lbl">Total watches</div></div>
        <div className="stat-card"><div className="stat-val">{stats.available}</div><div className="stat-lbl">Available</div></div>
        <div className="stat-card"><div className="stat-val">{stats.reserved}</div><div className="stat-lbl">Reserved</div></div>
        <div className="stat-card"><div className="stat-val">{stats.sold}</div><div className="stat-lbl">Sold</div></div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'dealers' ? 'active' : ''}`} onClick={() => setTab('dealers')}>Dealers ({dealers.length})</div>
        <div className={`tab ${tab === 'agents' ? 'active' : ''}`} onClick={() => setTab('agents')}>Agents ({agents.length})</div>
        <div className={`tab ${tab === 'invite' ? 'active' : ''}`} onClick={() => setTab('invite')}>Invite user</div>
      </div>

      {tab === 'invite' && (
        <div className="admin-section" style={{ maxWidth: 500 }}>
          {msg && <div className="success-msg">{msg}</div>}
          {error && <div className="error-msg">{error}</div>}
          <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
            Enter the email address and role. They'll receive an email invitation to set their password and access the catalog.
          </p>
          <form onSubmit={handleInvite}>
            <div className="form-row">
              <label>Email address</label>
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="dealer@company.com" required />
            </div>
            <div className="form-row">
              <label>Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                <option value="dealer">Dealer — can browse catalog, reserve watches</option>
                <option value="agent">Agent — can post new watches</option>
              </select>
            </div>
            <button type="submit" className="btn btn-dark btn-full" disabled={inviting}>
              {inviting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Send invitation'}
            </button>
          </form>

          <div style={{ marginTop: 24, padding: 16, background: '#f7f6f3', borderRadius: 10, fontSize: 12, color: '#888', lineHeight: 1.6 }}>
            <strong style={{ color: '#555', display: 'block', marginBottom: 4 }}>How invitations work</strong>
            This records the invitation in the database. To send the actual email, go to your Supabase dashboard → Authentication → Users → Invite user and enter the email there. This creates the account and sends them a setup email automatically.
          </div>
        </div>
      )}

      {(tab === 'dealers' || tab === 'agents') && (
        <div className="admin-section">
          {loading ? <div className="spinner" /> : (
            (tab === 'dealers' ? dealers : agents).length === 0
              ? <div className="empty-state">No {tab} yet</div>
              : (tab === 'dealers' ? dealers : agents).map(u => (
                <div key={u.id} className="user-row">
                  <div className={`avatar ${avatarColor(u.full_name)}`}>{initials(u.full_name)}</div>
                  <div className="user-row-info">
                    <div className="user-row-name">{u.full_name}</div>
                    <div className="user-row-meta">Joined {new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  </div>
                  <span className={`badge badge-${u.role}`}>{u.role}</span>
                  <div className="user-row-actions">
                    {u.role === 'dealer' && (
                      <button className="btn btn-sm" onClick={() => changeRole(u.id, 'agent')}>Make agent</button>
                    )}
                    {u.role === 'agent' && (
                      <button className="btn btn-sm" onClick={() => changeRole(u.id, 'dealer')}>Make dealer</button>
                    )}
                    {u.role !== 'admin' && (
                      <button className="btn btn-sm btn-danger" onClick={() => changeRole(u.id, 'dealer')}>Revoke</button>
                    )}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}
