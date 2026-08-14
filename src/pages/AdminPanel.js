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

function SidebarIcon({ id }) {
  if (id === 'overview') return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  )
  if (id === 'dealers') return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  )
  if (id === 'agents') return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
      <path d="M16 11c1.7 0 3 1.3 3 3m3 6c0-2.8-1.8-5-4-5.5" strokeLinecap="round"/>
    </svg>
  )
  if (id === 'suppliers') return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <path d="M20 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/>
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
    </svg>
  )
  if (id === 'supplier_queue') return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  )
  if (id === 'rates') return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  )
  if (id === 'invite') return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  )
  if (id === 'sync') return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" strokeLinecap="round"/>
    </svg>
  )
  return null
}

export default function AdminPanel() {
  const [tab, setTab] = useState('overview')
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
  const [bagsMissingRunning, setBagsMissingRunning] = useState(false)
  const [bagsMissingResult, setBagsMissingResult] = useState(null)
  const [imagesSyncing, setImagesSyncing] = useState(false)
  const [imagesResult, setImagesResult] = useState(null)
  const [syncLog, setSyncLog] = useState({})
  const [currentRatesData, setCurrentRatesData] = useState({})
  const [rateInputs, setRateInputs] = useState({})
  const [savingRate, setSavingRate] = useState(null)
  const [rateMsg, setRateMsg] = useState('')
  const [supplierListings, setSupplierListings] = useState([])

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
      { count: total }, { count: available }, { count: reserved }, { count: sold },
    ] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'available'),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'reserved'),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'sold'),
    ])
    setStats({ total: total || 0, available: available || 0, reserved: reserved || 0, sold: sold || 0 })
  }, [])

  const fetchSupplierListings = useCallback(async () => {
    const { data } = await supabase
      .from('supplier_listings')
      .select('*, supplier_listing_images(url, position), profiles!supplier_id(full_name, phone)')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
    setSupplierListings(data || [])
  }, [])

  useEffect(() => { fetchUsers(); fetchStats(); fetchSyncLog(); fetchSupplierListings() }, [fetchUsers, fetchStats, fetchSyncLog, fetchSupplierListings])

  async function handleInvite(e) {
    e.preventDefault()
    setError(''); setMsg('')
    if (!inviteEmail) return
    setInviting(true)
    try {
      const body = JSON.stringify({ email: inviteEmail, role: inviteRole, full_name: inviteName || inviteEmail.split('@')[0] })
      const res = await fetch('https://tulqgebsvpxgwocptnmy.supabase.co/functions/v1/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA' },
        body
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Invite failed')
      setMsg(`Invite sent to ${inviteEmail}`)
      setInviteEmail(''); setInviteName('')
      fetchUsers()
    } catch (err) { setError(err.message || 'Something went wrong.') }
    setInviting(false)
  }

  async function handleSync() {
    setSyncing(true); setSyncResult(null); setSyncError('')
    const BATCH_SIZE = 20; let offset = 0
    let totalAdded = 0, totalUpdated = 0, totalRemoved = 0, totalImages = 0, grandTotal = 0
    try {
      while (true) {
        let data = null; let attempt = 0
        while (attempt < 5) {
          try {
            const res = await fetch('/api/zoho-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_size: BATCH_SIZE, offset }) })
            data = await res.json()
            if (!res.ok) {
              const m = data.error || ''
              if (m.toLowerCase().includes('too many') || m.toLowerCase().includes('rate') || m.toLowerCase().includes('access denied')) {
                setSyncError(`Rate limit hit — retrying in 8s... (attempt ${attempt + 1}/5)`)
                await new Promise(r => setTimeout(r, 8000)); setSyncError(''); attempt++; continue
              }
              throw new Error(m || 'Sync failed')
            }
            break
          } catch (err) { if (attempt >= 4) throw err; await new Promise(r => setTimeout(r, 3000)); attempt++ }
        }
        totalAdded += data.added || 0; totalUpdated += data.updated || 0; totalRemoved += data.removed || 0
        totalImages += data.images_added || 0; grandTotal = data.total || grandTotal
        const processed = offset + (data.processed || 0)
        setSyncResult({ inProgress: !data.done, added: totalAdded, updated: totalUpdated, removed: totalRemoved, images_added: totalImages, processed, total: grandTotal, pct: grandTotal ? Math.round((processed / grandTotal) * 100) : 0 })
        if (data.done || !data.next_offset) break
        offset = data.next_offset
      }
      fetchStats()
    } catch (err) { setSyncError(`Failed at item ${offset} — ${err.message}`); setSyncResult(prev => prev ? { ...prev, inProgress: false } : null) }
    setSyncing(false)
  }

  async function handleTestCronZoho() {
    setCronZohoRunning(true); setCronZohoResult(null)
    try { const res = await fetch('/api/cron-zoho-sync'); setCronZohoResult(await res.json()) }
    catch (err) { setCronZohoResult({ error: err.message }) }
    setCronZohoRunning(false)
  }

  async function handleSyncImages() {
    setImagesSyncing(true); setImagesResult(null)
    const BATCH_SIZE = 5; let offset = 0; let totalImages = 0; let grandTotal = 0
    try {
      while (true) {
        const res = await fetch('/api/zoho-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_size: BATCH_SIZE, offset }) })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Image sync failed')
        totalImages += data.images_added || 0; grandTotal = data.total || grandTotal
        setImagesResult({ inProgress: !data.done, images_added: totalImages, processed: offset + (data.processed || 0), total: grandTotal })
        if (data.done || !data.next_offset) break
        offset = data.next_offset
      }
    } catch (err) { setImagesResult({ error: err.message }) }
    setImagesSyncing(false)
  }

  async function handleTestCronBags() {
    setCronBagsRunning(true); setCronBagsResult(null)
    try { const res = await fetch('/api/cron-odoo-bags-sync'); setCronBagsResult(await res.json()) }
    catch (err) { setCronBagsResult({ error: err.message }) }
    setCronBagsRunning(false)
  }

  async function handleBagsMissingSync() {
    setBagsMissingRunning(true); setBagsMissingResult(null)
    try { const res = await fetch('/api/odoo-bags-sync-missing?limit=50'); setBagsMissingResult(await res.json()) }
    catch (err) { setBagsMissingResult({ error: err.message }) }
    setBagsMissingRunning(false)
  }

  async function handleOdooSync() {
    setOdooSyncing(true); setOdooResult(null); setOdooError('')
    const BATCH_SIZE = 5; let offset = 0; let totalAdded = 0, totalUpdated = 0, totalImages = 0, grandTotal = 0
    try {
      while (true) {
        let data = null; let lastError = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch('/api/odoo-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_size: BATCH_SIZE, offset }) })
            data = await res.json(); if (!res.ok) throw new Error(data.error || 'Odoo sync failed'); lastError = null; break
          } catch (err) { lastError = err; await new Promise(r => setTimeout(r, 2000)) }
        }
        if (lastError) throw lastError
        totalAdded += data.added || 0; totalUpdated += data.updated || 0; totalImages += data.images_added || 0; grandTotal = data.total || grandTotal
        setOdooResult({ inProgress: !data.done, added: totalAdded, updated: totalUpdated, images_added: totalImages, processed: offset + (data.processed || 0), total: grandTotal })
        if (data.done || !data.next_offset) break; offset = data.next_offset
      }
      fetchStats()
    } catch (err) { setOdooError(err.message || 'Odoo sync failed.') }
    setOdooSyncing(false)
  }

  async function handleBagsSync() {
    setBagsSyncing(true); setBagsResult(null); setBagsError('')
    const BATCH_SIZE = 2; let offset = 0; let totalAdded = 0, totalUpdated = 0, totalRemoved = 0, totalImages = 0, grandTotal = 0
    try {
      while (true) {
        let data = null; let lastError = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch('/api/odoo-bags-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_size: BATCH_SIZE, offset }) })
            data = await res.json(); if (!res.ok) throw new Error(data.error || 'Bags sync failed'); lastError = null; break
          } catch (err) { lastError = err; await new Promise(r => setTimeout(r, 2000)) }
        }
        if (lastError) throw lastError
        totalAdded += data.added || 0; totalUpdated += data.updated || 0; totalRemoved += data.removed || 0; totalImages += data.images_added || 0; grandTotal = data.total || grandTotal
        setBagsResult({ inProgress: !data.done, added: totalAdded, updated: totalUpdated, removed: totalRemoved, images_added: totalImages, processed: offset + (data.processed || 0), total: grandTotal })
        if (data.done || !data.next_offset) break; offset = data.next_offset
      }
      fetchStats()
    } catch (err) { setBagsError(err.message || 'Bags sync failed.') }
    setBagsSyncing(false)
  }

  async function handleExtractJewelleryTypes() {
    setExtractingJewellery(true); setExtractResult(null); setExtractError('')
    try {
      const res = await fetch('/api/extract-jewellery-types', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Extraction failed')
      setExtractResult(data)
    } catch (err) { setExtractError(err.message || 'Something went wrong') }
    setExtractingJewellery(false)
  }

  async function changeRole(userId, newRole) {
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    if (error) { alert('Failed to update role: ' + error.message); return }
    fetchUsers()
  }

  async function handleRevoke(userId, userName) {
    if (!window.confirm(`Remove ${userName || 'this user'}? They will lose access immediately.`)) return
    await supabase.from('invite_tokens').update({ used_by: null }).eq('used_by', userId)
    const { error } = await supabase.from('profiles').delete().eq('id', userId)
    if (error) { alert('Failed to remove user: ' + error.message); return }
    fetchUsers()
  }

  const RATE_PAIRS = [
    { from: 'USD', to: 'CNY', label: 'USD → CNY', desc: 'US Dollar to Chinese Yuan — local exchange rate (used to convert supplier CNY prices via USD → EUR)' },
    { from: 'HKD', to: 'EUR', label: 'HKD → EUR', desc: 'Hong Kong Dollar to Euro — supplier price conversion' },
    { from: 'EUR', to: 'USD', label: 'EUR → USD', desc: 'Euro to US Dollar — second leg of CNY conversion + display' },
  ]

  async function fetchCurrentRatesData() {
    const results = {}
    for (const { from, to } of RATE_PAIRS) {
      const { data } = await supabase
        .from('exchange_rates').select('rate, fetched_at')
        .eq('from_currency', from).eq('to_currency', to)
        .order('fetched_at', { ascending: false }).limit(1)
      if (data?.[0]) results[`${from}-${to}`] = data[0]
    }
    setCurrentRatesData(results)
    const inputs = {}
    for (const { from, to } of RATE_PAIRS) {
      const key = `${from}-${to}`
      if (results[key]) inputs[key] = String(results[key].rate)
    }
    setRateInputs(prev => ({ ...inputs, ...prev }))
  }

  async function handleSaveRate(from, to, value) {
    const num = parseFloat(value)
    if (!num || num <= 0) return
    const key = `${from}-${to}`
    setSavingRate(key)
    try {
      const { error } = await supabase.from('exchange_rates').insert({
        from_currency: from, to_currency: to, rate: num,
        fetched_at: new Date().toISOString(),
      })
      if (error) throw error
      setRateMsg(`${from} → ${to} set to ${num}`)
      setTimeout(() => setRateMsg(''), 4000)
      fetchCurrentRatesData()
    } catch (e) { alert('Failed to save: ' + e.message) }
    setSavingRate(null)
  }

  useEffect(() => { if (tab === 'rates') fetchCurrentRatesData() }, [tab])

  const dealers = users.filter(u => u.role === 'dealer')
  const agents = users.filter(u => u.role === 'agent')
  const suppliers = users.filter(u => u.role === 'supplier')

  const NAV = [
    { id: 'overview', label: 'Overview' },
    { id: 'dealers', label: 'Dealers', count: dealers.length },
    { id: 'agents', label: 'Agents', count: agents.length },
    { id: 'suppliers', label: 'Suppliers', count: suppliers.length },
    { id: 'supplier_queue', label: 'Supplier Queue', count: supplierListings.length, accent: supplierListings.length > 0 },
    { id: 'rates', label: 'Exchange Rates' },
    { id: 'invite', label: 'Invite User' },
    { id: 'sync', label: 'Sync' },
  ]

  const q = search.trim().toLowerCase()

  function UserList({ list }) {
    const filtered = q ? list.filter(u =>
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q)
    ) : list

    if (loading) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>

    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.35 }}>
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or phone…" style={{ paddingLeft: 32, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--faint)', display: 'flex', alignItems: 'center' }}>
            {filtered.length}{filtered.length !== list.length ? ` of ${list.length}` : ''} user{list.length !== 1 ? 's' : ''}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">{search ? 'No results for that search.' : `No users yet — invite one below.`}</div>
        ) : (
          <div style={{ border: '1px solid var(--border-light)', borderRadius: 14, overflow: 'hidden' }}>
            {filtered.map((u, i) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: 'var(--surface)', borderTop: i > 0 ? '1px solid var(--border-light)' : 'none' }}>
                <div className={`avatar ${avatarColor(u.full_name)}`} style={{ flexShrink: 0, width: 38, height: 38, fontSize: 13 }}>
                  {initials(u.full_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{u.full_name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}{u.phone ? ` · ${u.phone}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--faint)', flexShrink: 0 }}>
                  {new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {u.role === 'dealer' && <button className="btn btn-sm" onClick={() => changeRole(u.id, 'agent')} style={{ fontSize: 11 }}>Make agent</button>}
                  {u.role === 'agent' && <button className="btn btn-sm" onClick={() => changeRole(u.id, 'dealer')} style={{ fontSize: 11 }}>Make dealer</button>}
                  {u.role === 'supplier' && <button className="btn btn-sm" onClick={() => changeRole(u.id, 'dealer')} style={{ fontSize: 11 }}>Make dealer</button>}
                  {u.role !== 'admin' && <button className="btn btn-sm btn-danger" onClick={() => handleRevoke(u.id, u.full_name)} style={{ fontSize: 11 }}>Revoke</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  function SyncCard({ icon, title, subtitle, logKey, description, children }) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--faint)' }}>{subtitle}</div>
          </div>
          {syncLog[logKey] && (
            <div style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'right', lineHeight: 1.5 }}>
              <div style={{ color: '#4ade80', fontWeight: 600, fontSize: 10 }}>● SYNCED</div>
              <div>{fmtAge(syncLog[logKey])}</div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.6, marginBottom: 14 }}>{description}</div>
        {children}
      </div>
    )
  }

  function SyncResultBar({ result, error }) {
    if (!result && !error) return null
    if (error) return <div className="error-msg" style={{ marginBottom: 10, fontSize: 12 }}>{error}</div>
    return (
      <div style={{ marginBottom: 12 }}>
        <div className="progress-wrap">
          <div className="progress-bar" style={{ width: `${result.pct ?? (result.total ? Math.round((result.processed / result.total) * 100) : (result.inProgress ? 5 : 100))}%` }} />
        </div>
        <div className="progress-label">
          {result.error ? `Error: ${result.error}` : result.inProgress
            ? `${result.processed} / ${result.total} items${result.pct != null ? ` (${result.pct}%)` : ''}`
            : `✓ Done — ${[result.added != null && `${result.added} added`, result.updated != null && `${result.updated} updated`, result.removed != null && `${result.removed} removed`, result.images_added != null && `${result.images_added} images`].filter(Boolean).join(' · ')}`
          }
        </div>
      </div>
    )
  }

  function SyncBtn({ onClick, disabled, running, label, runningLabel, secondary }) {
    return (
      <button className={`btn btn-full${secondary ? '' : ' btn-dark'}`} onClick={onClick} disabled={disabled} style={{ marginTop: secondary ? 8 : 0 }}>
        {running ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {runningLabel || 'Running...'}</> : label}
      </button>
    )
  }

  function InlineResult({ result, fallback }) {
    if (!result) return null
    return (
      <div style={{ marginTop: 8, fontSize: 12, padding: '8px 10px', borderRadius: 8, background: result.error ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.08)', color: result.error ? '#f87171' : '#4ade80' }}>
        {result.error ? `Error: ${result.error}` : (fallback ? fallback(result) : JSON.stringify(result))}
      </div>
    )
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Topbar />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <aside style={{
          width: 230, flexShrink: 0,
          borderRight: '1px solid #e5e7eb',
          background: '#fff',
          display: 'flex', flexDirection: 'column',
          padding: '20px 0 16px',
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9ca3af', padding: '0 16px', marginBottom: 6 }}>Admin</div>

          {NAV.map((item, i) => {
            const isActive = tab === item.id
            const divider = i === 6
            return (
              <div key={item.id}>
                {divider && <div style={{ height: 1, background: '#e5e7eb', margin: '8px 16px' }} />}
                <button
                  onClick={() => { setTab(item.id); setSearch('') }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 16px',
                    borderTop: 'none', borderRight: 'none', borderBottom: 'none',
                    borderLeft: isActive ? '2px solid #b8965a' : '2px solid transparent',
                    cursor: 'pointer', textAlign: 'left',
                    background: isActive ? '#faf6f0' : 'transparent',
                    color: isActive ? '#b8965a' : '#374151',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 14,
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  <span style={{ color: isActive ? '#b8965a' : '#6b7280', display: 'flex', flexShrink: 0 }}><SidebarIcon id={item.id} /></span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.count > 0 && (
                    <span style={{
                      background: item.accent ? '#f59e0b' : '#f3f4f6',
                      color: item.accent ? '#fff' : '#6b7280',
                      borderRadius: 10, fontSize: 11, fontWeight: 700,
                      padding: '1px 7px',
                    }}>
                      {item.count}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>

          {/* Overview */}
          {tab === 'overview' && (
            <div>
              <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Overview</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 32 }}>
                {[
                  { label: 'Total Items', value: stats.total, color: 'var(--text)' },
                  { label: 'Available', value: stats.available, color: '#22c55e' },
                  { label: 'Reserved', value: stats.reserved, color: '#f59e0b' },
                  { label: 'Sold', value: stats.sold, color: 'var(--faint)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: '20px 22px' }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value.toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 6 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  { id: 'dealers', label: 'Dealers', value: dealers.length, desc: 'Active dealer accounts' },
                  { id: 'agents', label: 'Agents', value: agents.length, desc: 'Active agent accounts' },
                  { id: 'suppliers', label: 'Suppliers', value: suppliers.length, desc: 'Active supplier accounts' },
                  { id: 'supplier_queue', label: 'Supplier Queue', value: supplierListings.length, desc: 'Pending submissions', accent: supplierListings.length > 0 },
                ].map(card => (
                  <div key={card.id}
                    onClick={() => setTab(card.id)}
                    style={{ background: 'var(--surface)', border: `1px solid ${card.accent ? '#f59e0b44' : 'var(--border-light)'}`, borderRadius: 14, padding: '18px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, transition: 'opacity 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: card.accent ? '#f59e0b' : 'var(--text)' }}>{card.value}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{card.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--faint)' }}>{card.desc}</div>
                    </div>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" style={{ opacity: 0.3 }}>
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dealers */}
          {tab === 'dealers' && (
            <div>
              <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Dealers</h2>
              <UserList list={dealers} />
            </div>
          )}

          {/* Agents */}
          {tab === 'agents' && (
            <div>
              <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Agents</h2>
              <UserList list={agents} />
            </div>
          )}

          {/* Suppliers */}
          {tab === 'suppliers' && (
            <div>
              <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Suppliers</h2>
              <UserList list={suppliers} />
            </div>
          )}

          {/* Supplier Queue */}
          {tab === 'supplier_queue' && (
            <div>
              <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Supplier Queue</h2>

              {supplierListings.length === 0 ? (
                <div className="empty-state">No pending supplier submissions.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
                  {supplierListings.map(listing => {
                    const imgs = (listing.supplier_listing_images || []).sort((a, b) => a.position - b.position)
                    return (
                      <div key={listing.id} style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: 16, display: 'flex', gap: 14 }}>
                        {imgs[0] && <img src={imgs[0].url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{listing.brand} {listing.model}</div>
                          {listing.reference && <div style={{ fontSize: 12, color: 'var(--faint)' }}>Ref. {listing.reference}</div>}
                          {listing.asking_price && <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>€{Number(listing.asking_price).toLocaleString()}</div>}
                          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                            From {listing.profiles?.full_name || '—'}{listing.profiles?.phone ? ` · ${listing.profiles.phone}` : ''}
                            {' · '}{new Date(listing.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 4 }}>To approve or reject, use the Agent Panel → Supplier Queue.</div>
                </div>
              )}
            </div>
          )}

          {/* Exchange Rates */}
          {tab === 'rates' && (
            <div style={{ maxWidth: 540 }}>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Exchange Rates</h2>
                <div style={{ fontSize: 13, color: 'var(--faint)' }}>Set today's rates — used for supplier price conversions across the platform</div>
              </div>

              {rateMsg && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#15803d' }}>
                  ✓ {rateMsg}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {RATE_PAIRS.map(({ from, to, label, desc }) => {
                  const key = `${from}-${to}`
                  const current = currentRatesData[key]
                  const isSaving = savingRate === key
                  return (
                    <div key={key} style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: '16px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>{label}</div>
                          <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{desc}</div>
                          {current && (
                            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                              Last set: {new Date(current.fetched_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                        {current && (
                          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{Number(current.rate).toFixed(4)}</div>
                            <div style={{ fontSize: 11, color: 'var(--faint)' }}>current</div>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="number"
                          step="0.0001"
                          placeholder={from === 'USD' && to === 'CNY' ? 'e.g. 7.25' : from === 'HKD' ? 'e.g. 0.1175' : 'e.g. 1.085'}
                          value={rateInputs[key] || ''}
                          onChange={e => setRateInputs(r => ({ ...r, [key]: e.target.value }))}
                          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-light)', fontSize: 14, background: 'var(--surface2)', color: 'var(--text)' }}
                        />
                        <button
                          className="btn btn-dark"
                          onClick={() => handleSaveRate(from, to, rateInputs[key])}
                          disabled={isSaving || !rateInputs[key]}
                          style={{ flexShrink: 0, padding: '8px 20px' }}
                        >
                          {isSaving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 10, fontSize: 12, color: 'var(--faint)', lineHeight: 1.6 }}>
                Saved rates take effect immediately for all agents and in all supplier price displays.
              </div>
            </div>
          )}

          {/* Invite */}
          {tab === 'invite' && (
            <div style={{ maxWidth: 480 }}>
              <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Invite User</h2>
              {msg && <div className="success-msg" style={{ marginBottom: 14 }}>{msg}</div>}
              {error && <div className="error-msg" style={{ marginBottom: 14 }}>{error}</div>}
              <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Full name</label>
                  <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Jean Michel" style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Email address</label>
                  <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="dealer@company.com" required style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Role</label>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ width: '100%' }}>
                    <option value="dealer">Dealer — browse catalog, reserve items</option>
                    <option value="agent">Agent — post new items</option>
                    <option value="supplier">Supplier — submit listings for review</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-dark btn-full" disabled={inviting} style={{ marginTop: 4 }}>
                  {inviting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Send invitation'}
                </button>
              </form>
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 10, fontSize: 12, color: 'var(--faint)', lineHeight: 1.6 }}>
                They'll receive an email with a link to set their password and access Brandville Vault immediately.
              </div>
            </div>
          )}

          {/* Sync */}
          {tab === 'sync' && (
            <div style={{ maxWidth: 560 }}>
              <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Sync</h2>

              <SyncCard icon="🛍" title="Zoho Commerce" subtitle="Watches & Bags" logKey="sync_zoho" description="Pulls all items from your Zoho store. Removed items are deleted automatically. Manually added items are never affected.">
                <SyncResultBar result={syncResult} error={syncError} />
                <SyncBtn onClick={handleSync} disabled={syncing} running={syncing} label="↻ Sync now" runningLabel="Syncing…" />
                <SyncBtn onClick={handleTestCronZoho} disabled={cronZohoRunning} running={cronZohoRunning} label="⏱ Test auto-sync cron" runningLabel="Running cron…" secondary />
                <InlineResult result={cronZohoResult} fallback={r => r.error ? `Error: ${r.error}` : `✓ Cron OK — ${r.upserted} updated · ${r.marked_sold} marked sold · ${r.total_recent} recent changes`} />
                <SyncBtn onClick={handleSyncImages} disabled={imagesSyncing} running={imagesSyncing} label="🖼 Sync missing images" runningLabel="Syncing images…" secondary />
                <InlineResult result={imagesResult} fallback={r => r.error ? `Error: ${r.error}` : r.inProgress ? `Fetching… ${r.processed} / ${r.total} · ${r.images_added} images` : `✓ Done — ${r.images_added} images added across ${r.total} items`} />
              </SyncCard>

              <SyncCard icon="💎" title="Odoo" subtitle="Jewellery" logKey="sync_odoo_jewellery" description="Pulls all jewellery items from Odoo. Status is updated automatically every 15 minutes.">
                <SyncResultBar result={odooResult} error={odooError} />
                <SyncBtn onClick={handleOdooSync} disabled={odooSyncing || syncing} running={odooSyncing} label="↻ Sync Jewellery from Odoo" runningLabel="Syncing…" />
              </SyncCard>

              <SyncCard icon="👜" title="Odoo — Bags" subtitle="Handbags · Totes · Backpacks · Pouches" logKey="sync_odoo_bags" description="Pulls published bags from Odoo with images. Price is calculated as cost + 40%. Only items visible on the website are synced.">
                <SyncResultBar result={bagsResult} error={bagsError} />
                <SyncBtn onClick={handleBagsSync} disabled={bagsSyncing || syncing || odooSyncing} running={bagsSyncing} label="↻ Sync Bags from Odoo" runningLabel="Syncing…" />
                <SyncBtn onClick={handleTestCronBags} disabled={cronBagsRunning} running={cronBagsRunning} label="⏱ Run nightly bags sync now" runningLabel="Running…" secondary />
                <InlineResult result={cronBagsResult} fallback={r => r.error ? `Error: ${r.error}` : `✓ Done — ${r.upserted} updated · ${r.removed} removed · ${r.total} total`} />
                <SyncBtn onClick={handleBagsMissingSync} disabled={bagsMissingRunning} running={bagsMissingRunning} label="🖼 Fix missing bag images" runningLabel="Running…" secondary />
                <InlineResult result={bagsMissingResult} fallback={r => r.error ? `Error: ${r.error}` : `✓ Done — ${r.images_added} images added · ${r.remaining || 0} remaining`} />
              </SyncCard>

              <SyncCard icon="✨" title="Extract Jewellery Types" subtitle="Rings · Bracelets · Necklaces · Earrings" description="Scans product names and sets the jewellery type for existing items that are missing it.">
                {extractResult && <div className="success-msg" style={{ marginBottom: 10, fontSize: 12 }}>✓ Updated {extractResult.updated} items — {extractResult.skipped} unrecognized</div>}
                {extractError && <div className="error-msg" style={{ marginBottom: 10, fontSize: 12 }}>{extractError}</div>}
                <SyncBtn onClick={handleExtractJewelleryTypes} disabled={extractingJewellery || syncing || odooSyncing} running={extractingJewellery} label="✨ Extract Types" runningLabel="Extracting…" />
              </SyncCard>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}
