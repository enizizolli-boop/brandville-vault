import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
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

export default function MyAccount() {
  const { profile, fetchProfile } = useAuth()
  const navigate = useNavigate()
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

  useEffect(() => { if (tab === 'offers') fetchOffers() }, [tab, fetchOffers])

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

  return (
    <div className="page">
      <Topbar />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 16px' }}>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8, fontWeight: 600 }}>Account</div>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 26, fontWeight: 400, color: 'var(--text)' }}>
            {profile?.full_name || 'My Account'}
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 24 }}>
          <div className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>Profile</div>
          <div className={`tab ${tab === 'offers' ? 'active' : ''}`} onClick={() => setTab('offers')}>
            My Offers
            {offers.filter(o => o.status === 'pending' || o.status === 'countered').length > 0 && (
              <span style={{ marginLeft: 5, background: '#e6a817', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>
                {offers.filter(o => o.status === 'pending' || o.status === 'countered').length}
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
                          onClick={() => navigate(`/catalog/${watch.id}`)}
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
                              <div style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} onClick={() => navigate(`/catalog/${watch.id}`)}>
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
