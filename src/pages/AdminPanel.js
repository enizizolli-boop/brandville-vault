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
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('dealer')
  const [inviting, setInviting] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [stats, setStats] = useState({ total: 0, available: 0, reserved: 0, sold: 0 })
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [syncError, setSyncError] = useState('')
  const [imageSyncing, setImageSyncing] = useState(false)
  const [imageProgress, setImageProgress] = useState(null)
  const [imageSyncError, setImageSyncError] = useState('')

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
    try {
      const body = JSON.stringify({
        email: inviteEmail,
        role: inviteRole,
        full_name: inviteName || inviteEmail.split('@')[0]
      })
      const res = await fetch('https://tulqgebsvpxgwocptnmy.supabase.co/functions/v1/send-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA'
        },
        body
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Invite failed')
      setMsg(`Invite sent to ${inviteEmail} — they'll receive an email to set their password and access the catalog.`)
      setInviteEmail('')
      setInviteName('')
      fetchUsers()
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    }
    setInviting(false)
  }

  async function handleSync(testMode = false) {
    setSyncing(true)
    setSyncResult(null)
    setSyncError('')
    try {
      const res = await fetch('/api/zoho-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_mode: testMode })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setSyncResult(data)
      fetchStats()
    } catch (err) {
      setSyncError(err.message || 'Sync failed. Please try again.')
    }
    setSyncing(false)
  }

  async function handleImageSync() {
    setImageSyncing(true)
    setImageProgress(null)
    setImageSyncError('')

    const BATCH_SIZE = 10
    let offset = 0
    let totalImages = 0
    let totalProcessed = 0

    try {
      while (true) {
        const res = await fetch('/api/zoho-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch_size: BATCH_SIZE, offset })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Image sync failed')

        totalProcessed += data.processed
        totalImages += data.images_added
        setImageProgress({ processed: totalProcessed, total: data.total, images: totalImages })

        if (data.done || !data.next_offset) break
        offset = data.next_offset
      }
    } catch (err) {
      setImageSyncError(err.message || 'Image sync failed')
    }

    setImageSyncing(false)
  }
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    fetchUsers()
  }

  const dealers = users.filter(u => u.role === 'dealer')
  const agents = users.filter(u => u.role === 'agent')

  return (
    <div className="page">
      <Topbar />
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat-card"><div className="stat-val">{stats.total}</div><div className="stat-lbl">Total items</div></div>
        <div className="stat-card"><div className="stat-val">{stats.available}</div><div className="stat-lbl">Available</div></div>
        <div className="stat-card"><div className="stat-val">{stats.reserved}</div><div className="stat-lbl">Reserved</div></div>
        <div className="stat-card"><div className="stat-val">{stats.sold}</div><div className="stat-lbl">Sold</div></div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'dealers' ? 'active' : ''}`} onClick={() => setTab('dealers')}>Dealers ({dealers.length})</div>
        <div className={`tab ${tab === 'agents' ? 'active' : ''}`} onClick={() => setTab('agents')}>Agents ({agents.length})</div>
        <div className={`tab ${tab === 'invite' ? 'active' : ''}`} onClick={() => setTab('invite')}>Invite user</div>
        <div className={`tab ${tab === 'sync' ? 'active' : ''}`} onClick={() => setTab('sync')}>Zoho Sync</div>
      </div>

      {tab === 'sync' && (
        <div className="admin-section" style={{ maxWidth: 500 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Sync from Zoho Commerce</div>
            <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
              Pulls all items currently listed on your Zoho Commerce store into Vault.
              Items removed from your store will be removed from Vault automatically.
              Manually added items in Vault are never affected.
            </div>
          </div>

          {syncResult && (
            <div className="success-msg" style={{ marginBottom: 12 }}>
              ✓ {syncResult.test_mode ? 'Test sync' : 'Sync'} complete — {syncResult.added} added, {syncResult.updated} updated, {syncResult.removed} removed, {syncResult.images_uploaded} images uploaded
              {syncResult.test_mode && <div style={{ marginTop: 4, fontSize: 12 }}>Test passed — run full sync when ready.</div>}
              {syncResult.errors && syncResult.errors.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#c00' }}>
                  {syncResult.errors.length} item(s) had errors.
                </div>
              )}
            </div>
          )}

          {syncError && (
            <div className="error-msg" style={{ marginBottom: 12 }}>{syncError}</div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-dark"
              style={{ flex: 1 }}
              onClick={() => handleSync(true)}
              disabled={syncing}
            >
              {syncing ? <span className="spinner" style={{ width: 16, height: 16 }} /> : '🧪 Test (1 item)'}
            </button>
            <button
              className="btn btn-dark"
              style={{ flex: 2 }}
              onClick={() => handleSync(false)}
              disabled={syncing}
            >
              {syncing ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                  Syncing...
                </span>
              ) : '↻ Full sync'}
            </button>
          </div>

          <div style={{ marginTop: 24, borderTop: '1px solid #e8e5e0', paddingTop: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Sync images from store</div>
            <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6, marginBottom: 12 }}>
              Fetches all product images from your Zoho Commerce store for each item. Runs in batches — safe to run anytime.
            </div>

            {imageProgress && (
              <div className="success-msg" style={{ marginBottom: 12 }}>
                {imageSyncing
                  ? `⏳ Syncing images... ${imageProgress.processed}/${imageProgress.total} items (${imageProgress.images} images so far)`
                  : `✓ Done — ${imageProgress.processed} items processed, ${imageProgress.images} images synced`
                }
              </div>
            )}

            {imageSyncError && (
              <div className="error-msg" style={{ marginBottom: 12 }}>{imageSyncError}</div>
            )}

            <button
              className="btn btn-dark btn-full"
              onClick={handleImageSync}
              disabled={imageSyncing || syncing}
            >
              {imageSyncing ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                  Syncing images...
                </span>
              ) : '🖼 Sync all images'}
            </button>
          </div>
        </div>
      )}

      {tab === 'invite' && (
        <div className="admin-section" style={{ maxWidth: 500 }}>
          {msg && <div className="success-msg">{msg}</div>}
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={handleInvite}>
            <div className="form-row">
              <label>Full name</label>
              <input
                type="text"
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder="Jean Michel"
              />
            </div>
            <div className="form-row">
              <label>Email address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="dealer@company.com"
                required
              />
            </div>
            <div className="form-row">
              <label>Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                <option value="dealer">Dealer — can browse catalog, reserve items</option>
                <option value="agent">Agent — can post new items</option>
              </select>
            </div>
            <button type="submit" className="btn btn-dark btn-full" disabled={inviting}>
              {inviting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Send invitation'}
            </button>
          </form>
          <div style={{ marginTop: 16, padding: 14, background: '#f7f6f3', borderRadius: 10, fontSize: 12, color: '#888', lineHeight: 1.6 }}>
            They will receive an email with a link to set their password and access Brandville Vault immediately.
          </div>
        </div>
      )}

      {(tab === 'dealers' || tab === 'agents') && (
        <div className="admin-section">
          {loading ? <div className="spinner" /> : (
            (tab === 'dealers' ? dealers : agents).length === 0
              ? <div className="empty-state">No {tab} yet — invite one from the Invite tab</div>
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
