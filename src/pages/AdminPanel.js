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
  const [odooSyncing, setOdooSyncing] = useState(false)
  const [odooResult, setOdooResult] = useState(null)
  const [odooError, setOdooError] = useState('')
  const [bagsSyncing, setBagsSyncing] = useState(false)
  const [bagsResult, setBagsResult] = useState(null)
  const [bagsError, setBagsError] = useState('')
  const [extractingJewellery, setExtractingJewellery] = useState(false)
  const [extractResult, setExtractResult] = useState(null)
  const [extractError, setExtractError] = useState('')

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers(data || [])
    setLoading(false)
  }, [])

  const fetchStats = useCallback(async () => {
    const { data } = await supabase.from('products').select('status')
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

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    setSyncError('')

    const BATCH_SIZE = 20
    let offset = 0
    let totalAdded = 0
    let totalUpdated = 0
    let totalRemoved = 0
    let totalImages = 0
    let grandTotal = 0

    try {
      while (true) {
        let data = null
        let attempt = 0
        while (attempt < 5) {
          try {
            const res = await fetch('/api/zoho-sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batch_size: BATCH_SIZE, offset })
            })
            data = await res.json()
            if (!res.ok) {
              const msg = data.error || ''
              if (msg.toLowerCase().includes('too many') || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('access denied')) {
                setSyncError(`Rate limit hit — auto-retrying in 8 seconds... (attempt ${attempt + 1}/5)`)
                await new Promise(r => setTimeout(r, 8000))
                setSyncError('')
                attempt++
                continue
              }
              throw new Error(msg || 'Sync failed')
            }
            break
          } catch (err) {
            if (attempt >= 4) throw err
            await new Promise(r => setTimeout(r, 3000))
            attempt++
          }
        }

        totalAdded += data.added || 0
        totalUpdated += data.updated || 0
        totalRemoved += data.removed || 0
        totalImages += data.images_added || 0
        grandTotal = data.total || grandTotal
        const processed = offset + (data.processed || 0)

        setSyncResult({
          inProgress: !data.done,
          added: totalAdded,
          updated: totalUpdated,
          removed: totalRemoved,
          images_added: totalImages,
          processed,
          total: grandTotal,
          pct: grandTotal ? Math.round((processed / grandTotal) * 100) : 0,
        })

        if (data.done || !data.next_offset) break
        offset = data.next_offset
      }
      fetchStats()
    } catch (err) {
      setSyncError(`Failed at item ${offset} — ${err.message}`)
      setSyncResult(prev => prev ? { ...prev, inProgress: false } : null)
    }
    setSyncing(false)
  }

  async function handleOdooSync() {
    setOdooSyncing(true)
    setOdooResult(null)
    setOdooError('')

    const BATCH_SIZE = 5
    let offset = 0
    let totalAdded = 0
    let totalUpdated = 0
    let totalImages = 0
    let grandTotal = 0
    const MAX_RETRIES = 3

    try {
      while (true) {
        let data = null
        let lastError = null

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const res = await fetch('/api/odoo-sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batch_size: BATCH_SIZE, offset })
            })
            data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Odoo sync failed')
            lastError = null
            break
          } catch (err) {
            lastError = err
            await new Promise(r => setTimeout(r, 2000))
          }
        }

        if (lastError) throw lastError

        totalAdded += data.added || 0
        totalUpdated += data.updated || 0
        totalImages += data.images_added || 0
        grandTotal = data.total || grandTotal

        setOdooResult({
          inProgress: !data.done,
          added: totalAdded,
          updated: totalUpdated,
          images_added: totalImages,
          processed: offset + (data.processed || 0),
          total: grandTotal,
        })

        if (data.done || !data.next_offset) break
        offset = data.next_offset
      }
      fetchStats()
    } catch (err) {
      setOdooError(err.message || 'Odoo sync failed.')
    }
    setOdooSyncing(false)
  }

  async function handleBagsSync() {
    setBagsSyncing(true)
    setBagsResult(null)
    setBagsError('')

    const BATCH_SIZE = 2
    let offset = 0
    let totalAdded = 0
    let totalUpdated = 0
    let totalRemoved = 0
    let totalImages = 0
    let grandTotal = 0
    const MAX_RETRIES = 3

    try {
      while (true) {
        let data = null
        let lastError = null

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const res = await fetch('/api/odoo-bags-sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batch_size: BATCH_SIZE, offset })
            })
            data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Bags sync failed')
            lastError = null
            break
          } catch (err) {
            lastError = err
            await new Promise(r => setTimeout(r, 2000))
          }
        }

        if (lastError) throw lastError

        totalAdded += data.added || 0
        totalUpdated += data.updated || 0
        totalRemoved += data.removed || 0
        totalImages += data.images_added || 0
        grandTotal = data.total || grandTotal

        setBagsResult({
          inProgress: !data.done,
          added: totalAdded,
          updated: totalUpdated,
          removed: totalRemoved,
          images_added: totalImages,
          processed: offset + (data.processed || 0),
          total: grandTotal,
        })

        if (data.done || !data.next_offset) break
        offset = data.next_offset
      }
      fetchStats()
    } catch (err) {
      setBagsError(err.message || 'Bags sync failed.')
    }
    setBagsSyncing(false)
  }

  async function handleExtractJewelleryTypes() {
    setExtractingJewellery(true)
    setExtractResult(null)
    setExtractError('')
    try {
      const res = await fetch('/api/extract-jewellery-types', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Extraction failed')
      setExtractResult(data)
    } catch (err) {
      setExtractError(err.message || 'Something went wrong')
    }
    setExtractingJewellery(false)
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
        <div className="stat-card"><div className="stat-val">{stats.total}</div><div className="stat-lbl">Total items</div></div>
        <div className="stat-card"><div className="stat-val">{stats.available}</div><div className="stat-lbl">Available</div></div>
        <div className="stat-card"><div className="stat-val">{stats.reserved}</div><div className="stat-lbl">Reserved</div></div>
        <div className="stat-card"><div className="stat-val">{stats.sold}</div><div className="stat-lbl">Sold</div></div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'dealers' ? 'active' : ''}`} onClick={() => setTab('dealers')}>Dealers ({dealers.length})</div>
        <div className={`tab ${tab === 'agents' ? 'active' : ''}`} onClick={() => setTab('agents')}>Agents ({agents.length})</div>
        <div className={`tab ${tab === 'invite' ? 'active' : ''}`} onClick={() => setTab('invite')}>Invite user</div>
        <div className={`tab ${tab === 'sync' ? 'active' : ''}`} onClick={() => setTab('sync')}>Sync</div>
      </div>

      {tab === 'sync' && (
        <div className="admin-section" style={{ maxWidth: 520 }}>

          {/* Zoho sync */}
          <div style={{ background: '#fff', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🛍</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Zoho Commerce</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>Watches & Bags</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6, marginBottom: 14 }}>
              Pulls all items from your Zoho store. Removed items are deleted automatically. Manually added items are never affected.
            </div>

            {syncResult && (
              <div style={{ marginBottom: 12 }}>
                <div className="progress-wrap">
                  <div className="progress-bar" style={{ width: `${syncResult.pct || (syncResult.inProgress ? 5 : 100)}%` }} />
                </div>
                <div className="progress-label">
                  {syncResult.inProgress
                    ? `${syncResult.processed} / ${syncResult.total} items (${syncResult.pct || 0}%)`
                    : `✓ Done — ${syncResult.added} added · ${syncResult.updated} updated · ${syncResult.removed} removed · ${syncResult.images_added} images`
                  }
                </div>
              </div>
            )}

            {syncError && <div className="error-msg" style={{ marginBottom: 10, fontSize: 12 }}>{syncError}</div>}

            <button className="btn btn-dark btn-full" onClick={handleSync} disabled={syncing}>
              {syncing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Syncing...</> : '↻ Sync now'}
            </button>
          </div>

          {/* Odoo sync */}
          <div style={{ background: '#fff', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💎</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Odoo</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>Jewellery</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6, marginBottom: 14 }}>
              Pulls all jewellery items from Odoo. Status (available/sold) is updated automatically every 15 minutes.
            </div>

            {odooResult && (
              <div style={{ marginBottom: 12 }}>
                <div className="progress-wrap">
                  <div className="progress-bar" style={{ width: `${odooResult.total ? Math.round((odooResult.processed / odooResult.total) * 100) : (odooResult.inProgress ? 5 : 100)}%` }} />
                </div>
                <div className="progress-label">
                  {odooResult.inProgress
                    ? `${odooResult.processed} / ${odooResult.total} items`
                    : `✓ Done — ${odooResult.added} added · ${odooResult.updated} updated · ${odooResult.images_added} images`
                  }
                </div>
              </div>
            )}

            {odooError && <div className="error-msg" style={{ marginBottom: 10, fontSize: 12 }}>{odooError}</div>}

            <button className="btn btn-dark btn-full" onClick={handleOdooSync} disabled={odooSyncing || syncing}>
              {odooSyncing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Syncing...</> : '↻ Sync Jewellery from Odoo'}
            </button>
          </div>

          {/* Bags sync */}
          <div style={{ background: '#fff', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fce4ec', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👜</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Odoo — Bags</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>Handbags · Totes · Backpacks · Pouches</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6, marginBottom: 14 }}>
              Pulls published bags from Odoo with images. Price is calculated as cost + 40%. Only items visible on the website are synced.
            </div>

            {bagsResult && (
              <div style={{ marginBottom: 12 }}>
                <div className="progress-wrap">
                  <div className="progress-bar" style={{ width: `${bagsResult.total ? Math.round((bagsResult.processed / bagsResult.total) * 100) : (bagsResult.inProgress ? 5 : 100)}%` }} />
                </div>
                <div className="progress-label">
                  {bagsResult.inProgress
                    ? `${bagsResult.processed} / ${bagsResult.total} items`
                    : `✓ Done — ${bagsResult.added} added · ${bagsResult.updated} updated · ${bagsResult.removed} removed · ${bagsResult.images_added} images`
                  }
                </div>
              </div>
            )}

            {bagsError && <div className="error-msg" style={{ marginBottom: 10, fontSize: 12 }}>{bagsError}</div>}

            <button className="btn btn-dark btn-full" onClick={handleBagsSync} disabled={bagsSyncing || syncing || odooSyncing}>
              {bagsSyncing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Syncing...</> : '↻ Sync Bags from Odoo'}
            </button>
          </div>

          {/* Extract types */}
          <div style={{ background: '#fff', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>✨</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Extract Jewellery Types</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>Rings · Bracelets · Necklaces · Earrings</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6, marginBottom: 14 }}>
              Scans product names and sets the jewellery type for existing items that are missing it.
            </div>

            {extractResult && (
              <div className="success-msg" style={{ marginBottom: 10, fontSize: 12 }}>
                ✓ Updated {extractResult.updated} items — {extractResult.skipped} unrecognized
              </div>
            )}
            {extractError && <div className="error-msg" style={{ marginBottom: 10, fontSize: 12 }}>{extractError}</div>}

            <button className="btn btn-dark btn-full" onClick={handleExtractJewelleryTypes} disabled={extractingJewellery || syncing || odooSyncing}>
              {extractingJewellery ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Extracting...</> : '✨ Extract Types'}
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
