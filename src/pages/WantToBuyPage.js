import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toSlug } from '../lib/slug'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fmtBudget(amount, currency) {
  if (!amount) return null
  const n = Number(amount)
  if (!Number.isFinite(n)) return null
  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : ''
  return `${sym}${n.toLocaleString()} ${!sym ? currency || '' : ''}`.trim()
}

function matchBadge(req) {
  if (req.matched_product_id) return { label: 'In Stock', color: '#22c55e', dot: '#22c55e' }
  if (req.matched_preorder_id) return { label: 'Preorder', color: '#f59e0b', dot: '#f59e0b' }
  return { label: 'No Match', color: '#6b7280', dot: '#6b7280' }
}

function statusColor(status) {
  if (status === 'new') return '#60a5fa'
  if (status === 'matched') return '#22c55e'
  if (status === 'no_match') return '#6b7280'
  if (status === 'contacted') return '#f59e0b'
  if (status === 'closed') return '#9ca3af'
  return '#6b7280'
}

const STATUS_OPTIONS = ['new', 'matched', 'no_match', 'contacted', 'closed']
const SOURCE_OPTIONS = ['whatsapp', 'facebook']

// ─── icons ───────────────────────────────────────────────────────────────────

function WhatsAppIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#25d366', flexShrink: 0 }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#1877f2', flexShrink: 0 }}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6"/>
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  )
}

// ─── row ─────────────────────────────────────────────────────────────────────

function WTBRow({ req, isAdmin, onStatusChange, navigate }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const badge = matchBadge(req)

  async function handleStatus(newStatus) {
    if (!isAdmin) return
    setSaving(true)
    await supabase
      .from('want_to_buy_requests')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', req.id)
    onStatusChange(req.id, newStatus)
    setSaving(false)
  }

  const catalogSlug = req.matched_product
    ? toSlug(req.matched_product)
    : null

  const item = [req.brand, req.model, req.reference].filter(Boolean).join(' ') || '—'
  const budget = fmtBudget(req.budget_amount, req.budget_currency)

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* main row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer',
          background: open ? 'var(--surface)' : 'transparent', transition: 'background 0.1s' }}
      >
        {/* match badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 90 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: badge.dot, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: badge.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{badge.label}</span>
        </div>

        {/* item */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</div>
          {req.condition_pref && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{req.condition_pref}</div>}
        </div>

        {/* budget */}
        <div style={{ fontSize: 12, color: budget ? 'var(--text)' : 'var(--muted)', minWidth: 70, textAlign: 'right', whiteSpace: 'nowrap' }}>
          {budget || '—'}
        </div>

        {/* source + group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 120, justifyContent: 'flex-end' }}>
          {req.source === 'whatsapp' ? <WhatsAppIcon /> : <FacebookIcon />}
          <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
            {req.group_name || req.group_id || req.source}
          </span>
        </div>

        {/* time */}
        <div style={{ fontSize: 11, color: 'var(--muted)', minWidth: 55, textAlign: 'right', whiteSpace: 'nowrap' }}>
          {fmtDate(req.created_at)}
        </div>

        {/* status */}
        <div style={{ minWidth: 90, display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
          {isAdmin ? (
            <select
              value={req.status}
              onChange={e => handleStatus(e.target.value)}
              disabled={saving}
              style={{ fontSize: 11, padding: '2px 4px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--surface)', color: statusColor(req.status), cursor: 'pointer', maxWidth: 90 }}
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 11, color: statusColor(req.status), fontWeight: 500 }}>{req.status}</span>
          )}
        </div>

        <ChevronIcon open={open} />
      </div>

      {/* expanded detail */}
      {open && (
        <div style={{ padding: '12px 16px 16px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>

            {/* raw message */}
            <div style={{ flex: 2, minWidth: 220 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>
                Original message
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap',
                background: 'var(--bg)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
                {req.raw_text || '—'}
              </div>
            </div>

            {/* meta */}
            <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* sender */}
              {(req.sender || req.contact_info) && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>Sender</div>
                  <div style={{ fontSize: 12 }}>{req.sender || '—'}</div>
                  {req.contact_info && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{req.contact_info}</div>}
                </div>
              )}

              {/* match info */}
              {(req.matched_product_id || req.matched_preorder_id) && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>Match</div>
                  <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 6 }}>{req.matched_label || 'Matched'}</div>
                  {catalogSlug && (
                    <button
                      className="btn btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      onClick={() => navigate(`/catalog/${catalogSlug}`)}
                    >
                      View in catalog <ExternalLinkIcon />
                    </button>
                  )}
                  {req.matched_preorder_id && !catalogSlug && (
                    <button
                      className="btn btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      onClick={() => navigate('/agent?tab=preorders-watches')}
                    >
                      View preorders <ExternalLinkIcon />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function WantToBuyPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'

  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)

  // filters
  const [search, setSearch] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterGroup, setFilterGroup] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMatched, setFilterMatched] = useState('') // '' | 'yes' | 'no'

  const [groups, setGroups] = useState([])
  const searchTimer = useRef(null)

  const fetchRequests = useCallback(async (pg = 0, q = search, src = filterSource, grp = filterGroup, st = filterStatus, matched = filterMatched) => {
    setLoading(true)
    const from = pg * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('want_to_buy_requests')
      .select('*, matched_product:products(id, brand, model, reference)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (src) query = query.eq('source', src)
    if (grp) query = query.eq('group_name', grp)
    if (st) query = query.eq('status', st)
    if (matched === 'yes') query = query.not('matched_product_id', 'is', null)
    if (matched === 'no') query = query.is('matched_product_id', null).is('matched_preorder_id', null)
    if (q.trim()) {
      const like = `%${q.trim()}%`
      query = query.or(`brand.ilike.${like},model.ilike.${like},raw_text.ilike.${like}`)
    }

    const { data, error, count } = await query
    setLoading(false)
    if (error) { console.error('WTB fetch error:', error); return }
    setRequests(data || [])
    setTotal(count || 0)
    setPage(pg)
  }, [search, filterSource, filterGroup, filterStatus, filterMatched])

  // fetch distinct groups for filter dropdown
  useEffect(() => {
    supabase
      .from('want_to_buy_requests')
      .select('group_name', { head: false })
      .not('group_name', 'is', null)
      .then(({ data }) => {
        const unique = [...new Set((data || []).map(r => r.group_name).filter(Boolean))].sort()
        setGroups(unique)
      })
  }, [])

  useEffect(() => {
    if (!profile) return
    fetchRequests(0)
  }, [profile]) // eslint-disable-line

  function handleSearch(val) {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => fetchRequests(0, val, filterSource, filterGroup, filterStatus, filterMatched), 350)
  }

  function applyFilter(src, grp, st, matched) {
    setFilterSource(src)
    setFilterGroup(grp)
    setFilterStatus(st)
    setFilterMatched(matched)
    fetchRequests(0, search, src, grp, st, matched)
  }

  function handleStatusChange(id, newStatus) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r))
  }

  const hasFilters = filterSource || filterGroup || filterStatus || filterMatched || search

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Topbar />
      <div style={{ flex: 1, maxWidth: 1100, margin: '0 auto', width: '100%', padding: '28px 16px 60px' }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Want to Buy</h1>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Buyer requests from WhatsApp & Facebook groups · auto-updated
            </div>
          </div>
          {total > 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {total.toLocaleString()} request{total !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Search brand, model, message…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            style={{ flex: 1, minWidth: 180, fontSize: 13, padding: '7px 11px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />

          <select value={filterSource} onChange={e => applyFilter(e.target.value, filterGroup, filterStatus, filterMatched)}
            style={{ fontSize: 12, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">All sources</option>
            {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s === 'whatsapp' ? 'WhatsApp' : 'Facebook'}</option>)}
          </select>

          {groups.length > 0 && (
            <select value={filterGroup} onChange={e => applyFilter(filterSource, e.target.value, filterStatus, filterMatched)}
              style={{ fontSize: 12, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
              <option value="">All groups</option>
              {groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )}

          <select value={filterStatus} onChange={e => applyFilter(filterSource, filterGroup, e.target.value, filterMatched)}
            style={{ fontSize: 12, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filterMatched} onChange={e => applyFilter(filterSource, filterGroup, filterStatus, e.target.value)}
            style={{ fontSize: 12, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">All</option>
            <option value="yes">Matched only</option>
            <option value="no">Unmatched only</option>
          </select>

          {hasFilters && (
            <button className="btn btn-sm" onClick={() => {
              setSearch(''); setFilterSource(''); setFilterGroup(''); setFilterStatus(''); setFilterMatched('')
              fetchRequests(0, '', '', '', '', '')
            }}>
              Clear
            </button>
          )}
        </div>

        {/* table */}
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>

          {/* column headers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 8px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', minWidth: 90 }}>Match</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', flex: 1 }}>Item</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', minWidth: 70, textAlign: 'right' }}>Budget</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', minWidth: 120, textAlign: 'right' }}>From</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', minWidth: 55, textAlign: 'right' }}>When</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', minWidth: 90, textAlign: 'right' }}>Status</div>
            <div style={{ width: 14 }} />
          </div>

          {loading && requests.length === 0 && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          )}

          {!loading && requests.length === 0 && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {hasFilters ? 'No requests match your filters.' : 'No want-to-buy requests yet.'}
            </div>
          )}

          {requests.map(req => (
            <WTBRow
              key={req.id}
              req={req}
              isAdmin={isAdmin}
              onStatusChange={handleStatusChange}
              navigate={navigate}
            />
          ))}
        </div>

        {/* pagination */}
        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <button className="btn btn-sm" disabled={page === 0} onClick={() => fetchRequests(page - 1)}>← Prev</button>
            <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
              Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
            </span>
            <button className="btn btn-sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => fetchRequests(page + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
