import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Topbar from '../components/Topbar'

const AVATAR_COLORS = ['avatar-blue', 'avatar-green', 'avatar-amber', 'avatar-purple', 'avatar-red']
function initials(name = '') { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() }
function avatarColor(name = '') { return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length] }

function fmtAge(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AdminPanel() {
  const [tab, setTab] = useState('dealers')
  const [search, setSearch] = useState('')
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
  const [cronZohoRunning, setCronZohoRunning] = useState(false)
  const [cronZohoResult, setCronZohoResult] = useState(null)
  const [cronBagsRunning, setCronBagsRunning] = useState(false)
  const [cronBagsResult, setCronBagsResult] = useState(null)
  const [imagesSyncing, setImagesSyncing] = useState(false)
  const [imagesResult, setImagesResult] = useState(null)
const [syncLog, setSyncLog] = useState({})

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers(data || [])
    setLoading(false)
  }, [])

  const fetchSyncLog = useCallback(async () => {
    const { data } = await supabase.from('sync_log').select('key, last_sync_at')
    if (data) {
      const map = {}
      data.forEach(r => { map[r.key] = r.last_sync_at })
      setSyncLog(map)
    }
  }, [])

  const fetchStats = useCallback(async () => {
    const [
      { count: total },
      { count: available },
      { count: reserved },
      { count: sold },
    ] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'available'),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'reserved'),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'sold'),
    ])
    setStats({ total: total || 0, available: available || 0, reserved: reserved || 0, sold: sold || 0 })
  }, [])

  useEffect(() => { fetchUsers(); fetchStats(); fetchSyncLog() }, [fetchUsers, fetchStats, fetchSyncLog])

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

  async function handleTestCronZoho() {
    setCronZohoRunning(true)
    setCronZohoResult(null)
    try {
      const res = await fetch('/api/cron-zoho-sync')
      const data = await res.json()
      setCronZohoResult(data)
    } catch (err) {
      setCronZohoResult({ error: err.message })
    }
    setCronZohoRunning(false)
  }

  async function handleSyncImages() {
    setImagesSyncing(true)
    setImagesResult(null)
    const BATCH_SIZE = 5
    let offset = 0
    let totalImages = 0
    let grandTotal = 0
    try {
      while (true) {
        const res = await fetch('/api/zoho-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch_size: BATCH_SIZE, offset })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Image sync failed')
        totalImages += data.images_added || 0
        grandTotal = data.total || grandTotal
        setImagesResult({ inProgress: !data.done, images_added: totalImages, processed: offset + (data.processed || 0), total: grandTotal })
        if (data.done || !data.next_offset) break
        offset = data.next_offset
      }
    } catch (err) {
      setImagesResult({ error: err.message })
    }
    setImagesSyncing(false)
  }

async function handleTestCronBags() {
    setCronBagsRunning(true)
    setCronBagsResult(null)
    try {
      const res = await fetch('/api/cron-odoo-bags-sync')
      const data = await res.json()
      setCronBagsResult(data)
    } catch (err) {
      setCronBagsResult({ error: err.message })
    }
    setCronBagsRunning(false)
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

  async function handleRevoke(userId, userName) {
    if (!window.confirm(`Remove ${userName || 'this user'}? They will lose access immediately.`)) return
    await supabase.from('profiles').delete().eq('id', userId)
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
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(22,163,74,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🛍</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Zoho Commerce</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>Watches & Bags</div>
              </div>
              {syncLog.sync_zoho && (
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', lineHeight: 1.4 }}>
                  <div style={{ color: '#4ade80', fontWeight: 600 }}>● synced</div>
                  <div>{fmtAge(syncLog.sync_zoho)}</div>
                </div>
              )}
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
            <button className="btn btn-full" onClick={handleTestCronZoho} disabled={cronZohoRunning} style={{ marginTop: 8 }}>
              {cronZohoRunning ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Running cron...</> : '⏱ Test auto-sync cron'}
            </button>
            {cronZohoResult && (
              <div style={{ marginTop: 8, fontSize: 12, padding: '8px 10px', borderRadius: 8, background: cronZohoResult.error ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)', color: cronZohoResult.error ? '#f87171' : '#4ade80' }}>
                {cronZohoResult.error
                  ? `Error: ${cronZohoResult.error}`
                  : `✓ Cron OK — ${cronZohoResult.upserted} updated · ${cronZohoResult.marked_sold} marked sold · ${cronZohoResult.total_recent} recent changes`
                }
              </div>
            )}
            <button className="btn btn-full" onClick={handleSyncImages} disabled={imagesSyncing} style={{ marginTop: 8 }}>
              {imagesSyncing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Syncing images...</> : '🖼 Sync missing images'}
            </button>
            {imagesResult && (
              <div style={{ marginTop: 8, fontSize: 12, padding: '8px 10px', borderRadius: 8, background: imagesResult.error ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)', color: imagesResult.error ? '#f87171' : '#4ade80' }}>
                {imagesResult.error
                  ? `Error: ${imagesResult.error}`
                  : imagesResult.inProgress
                    ? `Fetching... ${imagesResult.processed} / ${imagesResult.total} · ${imagesResult.images_added} images added`
                    : `✓ Done — ${imagesResult.images_added} images added across ${imagesResult.total} items`
                }
              </div>
            )}
          </div>

          {/* Odoo sync */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--gold-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💎</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Odoo</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>Jewellery</div>
              </div>
              {syncLog.sync_odoo_jewellery && (
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', lineHeight: 1.4 }}>
                  <div style={{ color: '#4ade80', fontWeight: 600 }}>● synced</div>
                  <div>{fmtAge(syncLog.sync_odoo_jewellery)}</div>
                </div>
              )}
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
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(220,38,38,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👜</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Odoo — Bags</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>Handbags · Totes · Backpacks · Pouches</div>
              </div>
              {syncLog.sync_odoo_bags && (
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', lineHeight: 1.4 }}>
                  <div style={{ color: '#4ade80', fontWeight: 600 }}>● synced</div>
                  <div>{fmtAge(syncLog.sync_odoo_bags)}</div>
                </div>
              )}
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
            <button className="btn btn-full" onClick={handleTestCronBags} disabled={cronBagsRunning} style={{ marginTop: 8 }}>
              {cronBagsRunning ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Running...</> : '⏱ Run nightly bags sync now'}
            </button>
            {cronBagsResult && (
              <div style={{ marginTop: 8, fontSize: 12, padding: '8px 10px', borderRadius: 8, background: cronBagsResult.error ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)', color: cronBagsResult.error ? '#f87171' : '#4ade80' }}>
                {cronBagsResult.error
                  ? `Error: ${cronBagsResult.error}`
                  : `✓ Done — ${cronBagsResult.upserted} updated · ${cronBagsResult.removed} removed · ${cronBagsResult.total} total`
                }
              </div>
            )}
          </div>

          {/* Extract types */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>✨</div>
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
          <div style={{ marginTop: 16, padding: 14, background: 'var(--surface2)', borderRadius: 10, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            They will receive an email with a link to set their password and access Brandville Vault immediately.
          </div>
        </div>
      )}

      {(tab === 'dealers' || tab === 'agents') && (
        <div className="admin-section">
          {loading ? (
            <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
          ) : (() => {
            const list = (tab === 'dealers' ? dealers : agents)
            const q = search.trim().toLowerCase()
            const filtered = q ? list.filter(u =>
              (u.full_name || '').toLowerCase().includes(q) ||
              (u.email || '').toLowerCase().includes(q) ||
              (u.phone || '').toLowerCase().includes(q)
            ) : list

            return (
              <>
                {/* Search + count header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}>
                      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder={`Search ${tab}…`}
                      style={{ paddingLeft: 32, width: '100%' }}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
                    {filtered.length} {filtered.length !== list.length ? `of ${list.length} ` : ''}{tab}
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <div className="empty-state">{search ? 'No results' : `No ${tab} yet — invite one from the Invite tab`}</div>
                ) : (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                    {filtered.map((u, i) => (
                      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: 'var(--surface)', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                        <div className={`avatar ${avatarColor(u.full_name)}`} style={{ flexShrink: 0, width: 36, height: 36, fontSize: 13 }}>
                          {initials(u.full_name)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{u.full_name || '—'}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.email}{u.phone ? ` · ${u.phone}` : ''}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, display: 'none', ['@media (min-width: 600px)']: { display: 'block' } }}>
                          {new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                          {u.role === 'dealer' && (
                            <button className="btn btn-sm" onClick={() => changeRole(u.id, 'agent')} style={{ fontSize: 11 }}>Make agent</button>
                          )}
                          {u.role === 'agent' && (
                            <button className="btn btn-sm" onClick={() => changeRole(u.id, 'dealer')} style={{ fontSize: 11 }}>Make dealer</button>
                          )}
                          {u.role !== 'admin' && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleRevoke(u.id, u.full_name)} style={{ fontSize: 11 }}>Revoke</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
