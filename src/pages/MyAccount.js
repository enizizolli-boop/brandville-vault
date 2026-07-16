import { useState, useEffect, useCallback } from 'react'
import { useNav } from '../hooks/useNav'
import { supabase } from '../lib/supabase'
import { toSlug } from '../lib/slug'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'
import Footer from '../components/Footer'

const SUPABASE_URL = 'https://tulqgebsvpxgwocptnmy.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA'

async function notifyOffer(payload) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify(payload)
    })
  } catch (e) {}
}

const STATUS_COLOR = { pending: '#e6a817', countered: '#b8965a', accepted: '#2e7d32', rejected: '#c62828' }
const ROLE_LABEL = { admin: 'Admin', agent: 'Agent', dealer: 'Dealer', b2c: 'B2C Client' }

function NavIcon({ name }) {
  const paths = {
    profile: (
      <>
        <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M3 14c0-2.761 2.239-4.5 5-4.5s5 1.739 5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </>
    ),
    clients: (
      <>
        <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M1.5 13.5c0-2.485 2.015-4 4.5-4s4.5 1.515 4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M15 13.5c0-2-1.343-3.5-3-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </>
    ),
    offers: (
      <>
        <rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M6 7h4M6 10h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </>
    ),
    listings: (
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M5 7h6M5 10h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M12 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M10.5 2.5L12 1l1.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </>
    ),
    saved: (
      <path d="M3 2h10a1 1 0 0 1 1 1v11.5l-6-3.5-6 3.5V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
    ),
    signout: (
      <>
        <path d="M10 8H3M6 5l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8 3h4a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </>
    ),
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      {paths[name]}
    </svg>
  )
}

export default function MyAccount() {
  const { profile, fetchProfile, signOut } = useAuth()
  const navigate = useNav()
  const isAgent = profile?.role === 'agent' || profile?.role === 'admin'
  const [isMobile, setIsMobile] = useState(window.innerWidth < 720)
  const [section, setSection] = useState('profile')

  // Profile
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')

  // Offers
  const [offers, setOffers] = useState([])
  const [offersLoading, setOffersLoading] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [statusTab, setStatusTab] = useState('pending')
  const [offersMsg, setOffersMsg] = useState('')

  // Clients
  const [clients, setClients] = useState([])
  const [pendingTokens, setPendingTokens] = useState([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [generatedLink, setGeneratedLink] = useState('')
  const [generating, setGenerating] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [copied, setCopied] = useState('')

  // Saved
  const [savedItems, setSavedItems] = useState([])
  const [savedLoading, setSavedLoading] = useState(false)

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 720)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  useEffect(() => {
    if (profile) { setFullName(profile.full_name || ''); setPhone(profile.phone || '') }
  }, [profile])

  // Fetch pending count on mount for nav badge
  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('offers')
      .select('id', { count: 'exact', head: true })
      .eq('dealer_id', profile.id)
      .in('status', ['pending', 'countered'])
      .then(({ count }) => setPendingCount(count || 0))
  }, [profile?.id])

  const fetchOffers = useCallback(async () => {
    if (!profile) return
    setOffersLoading(true)
    const { data } = await supabase
      .from('offers')
      .select('*, products(id, brand, model, reference, price_eur, product_images(url, position))')
      .eq('dealer_id', profile.id)
      .order('created_at', { ascending: false })
    const rows = data || []
    setOffers(rows)
    setPendingCount(rows.filter(o => o.status === 'pending' || o.status === 'countered').length)
    setOffersLoading(false)
  }, [profile])

  const fetchClients = useCallback(async () => {
    if (!profile?.id) return
    setClientsLoading(true)
    const [{ data: dealers }, { data: tokens }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, phone, created_at').eq('invited_by', profile.id).order('created_at', { ascending: false }),
      supabase.from('invite_tokens').select('id, token, created_at').eq('created_by', profile.id).eq('used', false).order('created_at', { ascending: false })
    ])
    setClients(dealers || [])
    setPendingTokens(tokens || [])
    setClientsLoading(false)
  }, [profile])

  useEffect(() => { if (section === 'offers') fetchOffers() }, [section, fetchOffers])
  useEffect(() => { if (section === 'clients') fetchClients() }, [section, fetchClients])

  const fetchSaved = useCallback(async () => {
    if (!profile?.id) return
    setSavedLoading(true)
    const { data } = await supabase
      .from('saved_items')
      .select('created_at, products(id, brand, model, reference, price_eur, category, product_images(url, position))')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
    setSavedItems((data || []).map(r => r.products).filter(Boolean))
    setSavedLoading(false)
  }, [profile])

  async function unsaveItem(productId) {
    await supabase.from('saved_items').delete().eq('user_id', profile.id).eq('product_id', productId)
    setSavedItems(prev => prev.filter(p => p.id !== productId))
  }

  useEffect(() => { if (section === 'saved') fetchSaved() }, [section, fetchSaved])

  async function handleSaveProfile() {
    if (!fullName.trim()) return
    setSaving(true); setProfileMsg('')
    const { error } = await supabase.from('profiles').update({ full_name: fullName.trim(), phone: phone.trim() || null }).eq('id', profile.id)
    if (error) setProfileMsg('Failed to save.')
    else { await fetchProfile(profile.id); setProfileMsg('Saved.') }
    setSaving(false)
  }

  async function handleGenerateLink() {
    setLinkError(''); setGenerating(true)
    const bytes = new Uint8Array(20)
    crypto.getRandomValues(bytes)
    const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    const { error } = await supabase.from('invite_tokens').insert({ token, created_by: profile.id })
    if (error) { setLinkError(error.message); setGenerating(false); return }
    setGeneratedLink(`${window.location.origin}/join/${token}`)
    setGenerating(false)
    fetchClients()
  }

  async function handleRevokeToken(id) {
    await supabase.from('invite_tokens').delete().eq('id', id)
    fetchClients()
  }

  function handleCopy(text, key) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  async function handleAcceptCounter(offer) {
    await supabase.rpc('accept_offer', { offer_id: offer.id })
    notifyOffer({ action: 'dealer_accepted', watch: offer.products, dealer_name: profile.full_name, dealer_whatsapp: offer.dealer_whatsapp, counter_price: offer.counter_price, agent_comment: offer.agent_comment })
    setOffersMsg('Counter offer accepted!')
    fetchOffers()
  }

  async function handleRejectCounter(offer) {
    await supabase.from('offers').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', offer.id)
    notifyOffer({ action: 'dealer_rejected', watch: offer.products, dealer_name: profile.full_name, dealer_whatsapp: offer.dealer_whatsapp, counter_price: offer.counter_price })
    setOffersMsg('Counter offer rejected.')
    fetchOffers()
  }

  function getThumb(w) {
    if (!w?.product_images?.length) return null
    return [...w.product_images].sort((a, b) => a.position - b.position)[0]?.url
  }

  function handleSignOut() { signOut().then(() => navigate('/login')) }

  function fmtDate(d) { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  function fmtPrice(n) { return n ? `€${Number(n).toLocaleString()}` : '—' }

  const initials = (profile?.full_name || profile?.email || '?')[0].toUpperCase()

  const navItems = [
    { key: 'profile', label: 'Profile', icon: 'profile' },
    ...(isAgent ? [{ key: 'clients', label: 'Clients', icon: 'clients' }] : []),
    { key: 'offers', label: 'My Offers', icon: 'offers', badge: pendingCount },
    { key: 'saved', label: 'Saved', icon: 'saved', badge: savedItems.length || 0 },
  ]

  // ── Profile tab ──
  const profileTab = (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Playfair Display', Georgia, serif" }}>Profile</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>Manage your personal information and contact details.</p>
        </div>
        <div style={{ flexShrink: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, maxWidth: 230 }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>Your information is secure and never shared with third parties.</div>
        </div>
      </div>
      {profileMsg && (
        <div className={profileMsg.includes('Failed') ? 'error-msg' : 'success-msg'} style={{ marginBottom: 16 }}>{profileMsg}</div>
      )}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#b8965a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Account Information</div>
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Full Name</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Email <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>(cannot be changed)</span></label>
            <input type="email" value={profile?.email || ''} disabled style={{ opacity: 0.45, cursor: 'not-allowed' }} />
          </div>
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Phone Number</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 234 567 8900" />
        </div>
      </div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#b8965a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Preferences</div>
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Preferred Currency</label>
            <select defaultValue="EUR" style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 14, cursor: 'pointer' }}>
              <option value="EUR">EUR (€)</option>
              <option value="USD">USD ($)</option>
            </select>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Language</label>
            <select defaultValue="en" style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 14, cursor: 'pointer' }}>
              <option value="en">English</option>
            </select>
          </div>
        </div>
      </div>
      <button className="btn btn-dark" onClick={handleSaveProfile} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (
          <>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            Save changes
          </>
        )}
      </button>
    </div>
  )

  // ── Clients tab ──
  const clientsTab = (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Playfair Display', Georgia, serif" }}>Clients</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>Invite dealers with one-time links and manage your network.</p>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>Generate invite link</div>
            {linkError && <div className="error-msg" style={{ marginBottom: 10 }}>{linkError}</div>}
            {generatedLink && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{generatedLink}</div>
                <button onClick={() => handleCopy(generatedLink, 'new')} className="btn btn-sm" style={{ flexShrink: 0, fontSize: 11 }}>
                  {copied === 'new' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            )}
            <button className="btn btn-dark" onClick={handleGenerateLink} disabled={generating} style={{ fontSize: 13 }}>
              {generating ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '+ New Link'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>Each link works once — share directly with your contact.</div>
          </div>
          <div style={{ flexShrink: 0, width: 88, height: 88, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <span style={{ position: 'absolute', top: 4, left: 6, fontSize: 13, color: '#b8965a', opacity: 0.45 }}>+</span>
            <span style={{ position: 'absolute', top: 8, right: 2, fontSize: 8, color: '#b8965a', opacity: 0.35 }}>✦</span>
            <span style={{ position: 'absolute', bottom: 6, left: 2, fontSize: 8, color: '#b8965a', opacity: 0.35 }}>✦</span>
            <span style={{ position: 'absolute', bottom: 2, right: 8, fontSize: 13, color: '#b8965a', opacity: 0.45 }}>+</span>
            <div style={{ width: 68, height: 68, background: 'rgba(184,150,90,0.08)', borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="34" height="34" fill="none" stroke="#b8965a" strokeWidth="1.4" viewBox="0 0 24 24">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
          </div>
        </div>
      </div>

      {!clientsLoading && pendingTokens.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
            Pending links ({pendingTokens.length})
          </div>
          {pendingTokens.map(t => {
            const link = `${window.location.origin}/join/${t.token}`
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</div>
                <button onClick={() => handleCopy(link, t.id)} className="btn btn-sm" style={{ fontSize: 11, flexShrink: 0 }}>
                  {copied === t.id ? '✓' : 'Copy'}
                </button>
                <button
                  onClick={() => handleRevokeToken(t.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                  title="Revoke"
                >×</button>
              </div>
            )
          })}
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
          {clientsLoading ? 'Loading…' : `Joined (${clients.length})`}
        </div>
        {!clientsLoading && clients.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '20px 0' }}>No dealers have joined yet.</div>
        )}
        {clients.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(184,150,90,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#b8965a', flexShrink: 0 }}>
              {(c.full_name || c.email || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{c.full_name || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.email}{c.phone ? ` · ${c.phone}` : ''}
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{fmtDate(c.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )

  // ── Offers tab ──
  const offersTab = (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Playfair Display', Georgia, serif" }}>My Offers</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>Track the offers you've submitted.</p>
      </div>
      {offersMsg && <div className="success-msg" style={{ marginBottom: 12 }}>{offersMsg}</div>}
      <div className="tabs" style={{ marginBottom: 16 }}>
        {['pending', 'countered', 'accepted', 'rejected'].map(s => {
          const cnt = offers.filter(o => o.status === s).length
          return (
            <div key={s} className={`tab ${statusTab === s ? 'active' : ''}`} onClick={() => setStatusTab(s)} style={{ textTransform: 'capitalize' }}>
              {s}
              {cnt > 0 && (
                <span style={{ marginLeft: 5, background: STATUS_COLOR[s], color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>{cnt}</span>
              )}
            </div>
          )
        })}
      </div>
      {offersLoading
        ? <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
        : offers.filter(o => o.status === statusTab).length === 0
          ? <div className="empty-state">No {statusTab} offers</div>
          : offers.filter(o => o.status === statusTab).map(offer => {
            const watch = offer.products
            const thumb = getThumb(watch)
            return (
              <div key={offer.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 10, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', gap: 14 }}>
                  <div
                    onClick={() => navigate(`/catalog/${toSlug(watch)}`)}
                    style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
                  >
                    {thumb ? <img src={thumb} alt={watch.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 22, opacity: 0.3 }}>◈</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} onClick={() => navigate(`/catalog/${toSlug(watch)}`)}>
                        {watch.brand} {watch.model}
                        {watch.reference && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 6 }}>{watch.reference}</span>}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[offer.status], textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>{offer.status}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 20 }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Your offer</div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{fmtPrice(offer.offer_price)}</div>
                      </div>
                      {offer.counter_price && (
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Counter</div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: '#b8965a' }}>{fmtPrice(offer.counter_price)}</div>
                        </div>
                      )}
                    </div>
                    {offer.dealer_comment && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', background: 'var(--bg)', borderRadius: 6, padding: '6px 10px' }}>
                        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7 }}>Your note · </span>
                        {offer.dealer_comment}
                      </div>
                    )}
                    {offer.agent_comment && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', background: 'rgba(184,150,90,0.06)', borderRadius: 6, padding: '6px 10px' }}>
                        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Agent · </span>
                        {offer.agent_comment}
                      </div>
                    )}
                    {offer.status === 'countered' && (
                      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                        <button className="btn btn-sm btn-green" onClick={() => handleAcceptCounter(offer)}>Accept {fmtPrice(offer.counter_price)}</button>
                        <button className="btn btn-sm" style={{ color: '#c00', borderColor: '#f09595' }} onClick={() => handleRejectCounter(offer)}>Reject</button>
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)' }}>{fmtDate(offer.created_at)}</div>
                  </div>
                </div>
              </div>
            )
          })
      }
    </div>
  )

  // ── Saved tab ──
  const savedTab = (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Playfair Display', Georgia, serif" }}>Saved</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>Items you've bookmarked from the catalog.</p>
      </div>
      {savedLoading
        ? <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
        : savedItems.length === 0
          ? <div className="empty-state">No saved items yet — bookmark items from the catalog</div>
          : <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                {savedItems.map(p => {
                  const thumb = p.product_images?.length
                    ? [...p.product_images].sort((a, b) => a.position - b.position)[0]?.url
                    : null
                  return (
                    <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', cursor: 'pointer' }} onClick={() => navigate(`/catalog/${toSlug(p)}`)}>
                      <div style={{ height: 200, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                        {thumb
                          ? <img src={thumb} alt={p.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 28, opacity: 0.2 }}>◈</span>
                        }
                        <button
                          onClick={e => { e.stopPropagation(); unsaveItem(p.id) }}
                          title="Remove"
                          style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 7, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#b8965a' }}
                        >
                          <svg width="13" height="13" fill="currentColor" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                          </svg>
                        </button>
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#b8965a', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>{p.brand}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{p.model}</div>
                        {p.reference && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Ref: {p.reference}</div>}
                        {p.price_eur && <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>€{Number(p.price_eur).toLocaleString()}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(184,150,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="16" height="16" fill="none" stroke="#b8965a" strokeWidth="1.6" viewBox="0 0 24 24">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>Keep track of what you love</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Bookmark items from the catalog and find them all in one place.</div>
                </div>
              </div>
            </>
      }
    </div>
  )

  const sectionContent = { profile: profileTab, clients: clientsTab, offers: offersTab, saved: savedTab }

  return (
    <div className="page">
      <Topbar />

      {isMobile ? (
        // ── Mobile ──
        <div>
          {/* Identity header */}
          <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(184,150,90,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 17, color: '#b8965a', flexShrink: 0 }}>
              {initials}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{profile?.full_name || 'My Account'}</div>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#b8965a', background: 'rgba(184,150,90,0.12)', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {ROLE_LABEL[profile?.role] || profile?.role}
              </span>
            </div>
          </div>
          {/* Horizontal tab nav */}
          <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--border)', padding: '0 8px' }}>
            {navItems.map(item => (
              <button
                key={item.key}
                onClick={() => setSection(item.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '12px 14px',
                  background: 'none', border: 'none',
                  borderBottom: section === item.key ? '2px solid #b8965a' : '2px solid transparent',
                  color: section === item.key ? '#b8965a' : 'var(--muted)',
                  cursor: 'pointer', fontSize: 13, fontWeight: section === item.key ? 600 : 400,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                <NavIcon name={item.icon} />
                {item.label}
                {item.badge > 0 && (
                  <span style={{ background: '#e6a817', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{item.badge}</span>
                )}
              </button>
            ))}
            {isAgent && (
              <button
                onClick={() => navigate(`/agent/${profile.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 14px', background: 'none', border: 'none', borderBottom: '2px solid transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <NavIcon name="listings" />
                My Listings
              </button>
            )}
            <button
              onClick={handleSignOut}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 14px', background: 'none', border: 'none', borderBottom: '2px solid transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              <NavIcon name="signout" />
              Sign out
            </button>
          </div>
          <div style={{ padding: '20px 16px' }}>{sectionContent[section]}</div>
        </div>
      ) : (
        // ── Desktop ──
        <div style={{ display: 'flex', maxWidth: 940, margin: '0 auto', padding: '40px 24px', gap: 28, alignItems: 'flex-start' }}>
          {/* Sidebar */}
          <div style={{ width: 220, flexShrink: 0, position: 'sticky', top: 24 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              {/* Identity section */}
              <div style={{ padding: '26px 18px 22px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(184,150,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 24, color: '#b8965a', margin: '0 auto 14px' }}>
                  {initials}
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 7 }}>{profile?.full_name || '—'}</div>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#b8965a', background: 'rgba(184,150,90,0.1)', padding: '3px 10px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {ROLE_LABEL[profile?.role] || profile?.role}
                </span>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.email}</div>
              </div>
              {/* Nav items */}
              <nav style={{ padding: '6px 0' }}>
                {navItems.map(item => {
                  const active = section === item.key
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSection(item.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px',
                        background: active ? 'rgba(184,150,90,0.06)' : 'none',
                        border: 'none',
                        borderLeft: active ? '2.5px solid #b8965a' : '2.5px solid transparent',
                        color: active ? '#b8965a' : 'var(--muted)',
                        cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
                        textAlign: 'left',
                      }}
                    >
                      <NavIcon name={item.icon} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {item.badge > 0 && (
                        <span style={{ background: '#e6a817', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700, lineHeight: 1.5 }}>{item.badge}</span>
                      )}
                    </button>
                  )
                })}
              </nav>
              {/* Bottom actions */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
                {isAgent && (
                  <button
                    onClick={() => navigate(`/agent/${profile.id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', borderLeft: '2.5px solid transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, textAlign: 'left' }}
                  >
                    <NavIcon name="listings" />
                    <span>My Listings</span>
                  </button>
                )}
                <button
                  onClick={handleSignOut}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', borderLeft: '2.5px solid transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, textAlign: 'left' }}
                >
                  <NavIcon name="signout" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          </div>
          {/* Content area */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {sectionContent[section]}
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}
