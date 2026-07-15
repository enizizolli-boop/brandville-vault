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

const ROLE_LABEL = { admin: 'Admin', agent: 'Agent', dealer: 'Dealer', b2c: 'B2C' }

export default function MyAccount() {
  const { profile, fetchProfile } = useAuth()
  const navigate = useNav()
  const isAgent = profile?.role === 'agent' || profile?.role === 'admin'

  const [tab, setTab] = useState('profile')

  // Profile state
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')

  // Offers state
  const [offers, setOffers] = useState([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [statusTab, setStatusTab] = useState('pending')
  const [offersMsg, setOffersMsg] = useState('')

  // Clients state
  const [clients, setClients] = useState([])
  const [pendingTokens, setPendingTokens] = useState([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [generatedLink, setGeneratedLink] = useState('')
  const [generating, setGenerating] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '')
      setPhone(profile.phone || '')
    }
  }, [profile])

  const fetchOffers = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('offers')
      .select('*, products(id, brand, model, reference, price_eur, product_images(url, position))')
      .eq('dealer_id', profile.id)
      .order('created_at', { ascending: false })
    setOffers(data || [])
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

  useEffect(() => { if (tab === 'offers') fetchOffers() }, [tab, fetchOffers])
  useEffect(() => { if (tab === 'clients') fetchClients() }, [tab, fetchClients])

  async function handleSaveProfile() {
    if (!fullName.trim()) return
    setSaving(true)
    setProfileMsg('')
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', profile.id)
    if (error) {
      setProfileMsg('Failed to save. Please try again.')
    } else {
      await fetchProfile(profile.id)
      setProfileMsg('Profile updated.')
    }
    setSaving(false)
  }

  async function handleGenerateLink() {
    setLinkError(''); setGenerating(true)
    const tokenBytes = new Uint8Array(20)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('')
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
    notifyOffer({
      action: 'dealer_accepted',
      watch: offer.products,
      dealer_name: profile.full_name,
      dealer_whatsapp: offer.dealer_whatsapp,
      counter_price: offer.counter_price,
      agent_comment: offer.agent_comment,
    })
    setOffersMsg('Counter offer accepted!')
    fetchOffers()
  }

  async function handleRejectCounter(offer) {
    await supabase.from('offers').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', offer.id)
    notifyOffer({
      action: 'dealer_rejected',
      watch: offer.products,
      dealer_name: profile.full_name,
      dealer_whatsapp: offer.dealer_whatsapp,
      counter_price: offer.counter_price,
    })
    setOffersMsg('Counter offer rejected.')
    fetchOffers()
  }

  function getThumb(w) {
    if (!w?.product_images?.length) return null
    return [...w.product_images].sort((a, b) => a.position - b.position)[0]?.url
  }

  function fmtPrice(amount) {
    if (!amount) return '—'
    return `€${Number(amount).toLocaleString()}`
  }

  const pendingOffersCount = offers.filter(o => o.status === 'pending' || o.status === 'countered').length

  return (
    <div className="page">
      <Topbar />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 16px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#b8965a22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 20, color: '#b8965a', flexShrink: 0 }}>
            {(profile?.full_name || profile?.email || '?')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 400, color: 'var(--text)' }}>
              {profile?.full_name || 'My Account'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: '#b8965a', background: '#b8965a18', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>
                {ROLE_LABEL[profile?.role] || profile?.role}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{profile?.email}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 24 }}>
          <div className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>Profile</div>
          {isAgent && (
            <div className={`tab ${tab === 'clients' ? 'active' : ''}`} onClick={() => setTab('clients')}>Clients</div>
          )}
          <div className={`tab ${tab === 'offers' ? 'active' : ''}`} onClick={() => setTab('offers')}>
            My Offers
            {pendingOffersCount > 0 && (
              <span style={{ marginLeft: 5, background: '#e6a817', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>
                {pendingOffersCount}
              </span>
            )}
          </div>
        </div>

        {/* Profile tab */}
        {tab === 'profile' && (
          <div className="card" style={{ padding: '24px' }}>
            {profileMsg && (
              <div className={profileMsg.includes('Failed') ? 'error-msg' : 'success-msg'} style={{ marginBottom: 16 }}>
                {profileMsg}
              </div>
            )}
            <div className="form-row">
              <label>Full name</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="form-row">
              <label>Email <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>(cannot be changed)</span></label>
              <input type="email" value={profile?.email || ''} disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} />
            </div>
            <div className="form-row">
              <label>Phone number</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 234 567 8900" />
            </div>
            <button className="btn btn-dark" onClick={handleSaveProfile} disabled={saving} style={{ marginTop: 4 }}>
              {saving ? '...' : 'Save changes'}
            </button>
          </div>
        )}

        {/* Clients tab */}
        {tab === 'clients' && (
          <div>
            <div className="card" style={{ padding: '20px', marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Generate invite link</div>
              {linkError && <div className="error-msg" style={{ marginBottom: 10 }}>{linkError}</div>}
              {generatedLink && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{generatedLink}</div>
                  <button onClick={() => handleCopy(generatedLink, 'new')} className="btn btn-sm" style={{ flexShrink: 0, fontSize: 12 }}>
                    {copied === 'new' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              )}
              <button className="btn btn-dark" onClick={handleGenerateLink} disabled={generating}>
                {generating ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '+ Generate new link'}
              </button>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>Each link can only be used once. Share it directly with the dealer.</div>
            </div>

            {!clientsLoading && pendingTokens.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Pending links ({pendingTokens.length})</div>
                {pendingTokens.map(t => {
                  const link = `${window.location.origin}/join/${t.token}`
                  return (
                    <div key={t.id} className="card" style={{ padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</div>
                      <button onClick={() => handleCopy(link, t.id)} className="btn btn-sm" style={{ fontSize: 11, flexShrink: 0 }}>
                        {copied === t.id ? '✓' : 'Copy'}
                      </button>
                      <button onClick={() => handleRevokeToken(t.id)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0, padding: '0 2px' }} title="Revoke">×</button>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              {clientsLoading ? 'Loading…' : `Joined dealers (${clients.length})`}
            </div>
            {!clientsLoading && clients.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 32 }}>No dealers have joined yet.</div>
            )}
            {clients.map(c => (
              <div key={c.id} className="card" style={{ padding: '14px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#b8965a22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: '#b8965a', flexShrink: 0 }}>
                  {(c.full_name || c.email || '?')[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.full_name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.email}</div>
                  {c.phone && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.phone}</div>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                  {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Offers tab */}
        {tab === 'offers' && (
          <div>
            {offersMsg && <div className="success-msg" style={{ marginBottom: 12 }}>{offersMsg}</div>}
            <div className="tabs" style={{ marginBottom: 16 }}>
              {['pending', 'countered', 'accepted', 'rejected'].map(s => {
                const count = offers.filter(o => o.status === s).length
                return (
                  <div key={s} className={`tab ${statusTab === s ? 'active' : ''}`} onClick={() => setStatusTab(s)} style={{ textTransform: 'capitalize' }}>
                    {s}{count > 0 && (
                      <span style={{ marginLeft: 5, background: STATUS_COLOR[s], color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>{count}</span>
                    )}
                  </div>
                )
              })}
            </div>

            {offersLoading
              ? <div className="loading-page" style={{ minHeight: 200 }}><div className="spinner" /></div>
              : offers.filter(o => o.status === statusTab).length === 0
                ? <div className="empty-state">No {statusTab} offers</div>
                : offers.filter(o => o.status === statusTab).map(offer => {
                  const watch = offer.products
                  const thumb = getThumb(watch)
                  return (
                    <div key={offer.id} style={{ border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginBottom: 12, background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div
                          onClick={() => navigate(`/catalog/${toSlug(watch)}`)}
                          style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
                        >
                          {thumb
                            ? <img src={thumb} alt={watch.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <span style={{ fontSize: 22 }}>◈</span>
                          }
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} onClick={() => navigate(`/catalog/${toSlug(watch)}`)}>
                                {watch.brand} {watch.model}
                              </div>
                              {watch.reference && <div style={{ fontSize: 11, color: '#aaa' }}>{watch.reference}</div>}
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[offer.status] || '#888', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
                              {offer.status}
                            </span>
                          </div>
                          <div style={{ marginTop: 10, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your offer</div>
                              <div style={{ fontSize: 15, fontWeight: 600 }}>{fmtPrice(offer.offer_price)}</div>
                            </div>
                            {offer.counter_price && (
                              <div>
                                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Counter offer</div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: '#b8965a' }}>{fmtPrice(offer.counter_price)}</div>
                              </div>
                            )}
                          </div>
                          {offer.dealer_comment && (
                            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface2)', borderRadius: 6, padding: '6px 10px' }}>
                              <span style={{ color: 'var(--faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Your note · </span>
                              {offer.dealer_comment}
                            </div>
                          )}
                          {offer.agent_comment && (
                            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', background: 'rgba(184,150,106,0.08)', borderRadius: 6, padding: '6px 10px' }}>
                              <span style={{ color: 'var(--faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Agent · </span>
                              {offer.agent_comment}
                            </div>
                          )}
                          {offer.status === 'countered' && (
                            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                              <button className="btn btn-sm btn-green" onClick={() => handleAcceptCounter(offer)}>
                                Accept {fmtPrice(offer.counter_price)}
                              </button>
                              <button className="btn btn-sm" style={{ color: '#c00', borderColor: '#f09595' }} onClick={() => handleRejectCounter(offer)}>
                                Reject
                              </button>
                            </div>
                          )}
                          <div style={{ marginTop: 8, fontSize: 10, color: '#bbb' }}>
                            {new Date(offer.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
            }
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}
