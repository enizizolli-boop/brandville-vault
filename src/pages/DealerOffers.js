import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'

const SUPABASE_URL = 'https://tulqgebsvpxgwocptnmy.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA'

async function notifyOffer(payload) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify(payload)
    })
  } catch (err) {
    console.log('Notify error:', err)
  }
}

const STATUS_COLOR = { pending: '#e6a817', countered: '#b8965a', accepted: '#2e7d32', rejected: '#c62828' }

export default function DealerOffers() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [statusTab, setStatusTab] = useState('pending')

  const fetchOffers = useCallback(async () => {
    const { data } = await supabase
      .from('offers')
      .select('*, watches(id, brand, model, reference, price_eur, watch_images(url, position))')
      .eq('dealer_id', profile.id)
      .order('created_at', { ascending: false })
    setOffers(data || [])
    setLoading(false)
  }, [profile])

  useEffect(() => { if (profile) fetchOffers() }, [profile, fetchOffers])

  async function handleAcceptCounter(offer) {
    const { error } = await supabase.rpc('accept_offer', { offer_id: offer.id })
    if (error) console.error('accept_offer error:', error)
    notifyOffer({
      action: 'dealer_accepted',
      watch: offer.watches,
      dealer_name: profile.full_name,
      dealer_whatsapp: offer.dealer_whatsapp,
      counter_price: offer.counter_price,
      agent_comment: offer.agent_comment,
    })
    setMsg('Counter offer accepted!')
    fetchOffers()
  }

  async function handleRejectCounter(offer) {
    await supabase.from('offers').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', offer.id)
    notifyOffer({
      action: 'dealer_rejected',
      watch: offer.watches,
      dealer_name: profile.full_name,
      dealer_whatsapp: offer.dealer_whatsapp,
      counter_price: offer.counter_price,
    })
    setMsg('Counter offer rejected.')
    fetchOffers()
  }

  function getThumb(w) {
    if (!w?.watch_images?.length) return null
    return [...w.watch_images].sort((a, b) => a.position - b.position)[0]?.url
  }

  function fmtPrice(amount) {
    if (!amount) return '—'
    return currency === 'EUR' ? `€${Number(amount).toLocaleString()}` : `$${Number(amount).toLocaleString()}`
  }

  return (
    <div className="page">
      <Topbar currency={currency} onCurrencyChange={setCurrency} />
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button className="btn btn-sm" onClick={() => navigate(-1)}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>My Offers</h2>
        </div>

        {msg && <div className="success-msg" style={{ marginBottom: 12 }}><div>{msg}</div></div>}

        <div className="tabs" style={{ marginBottom: 16 }}>
          {['pending', 'countered', 'accepted', 'rejected'].map(s => {
            const count = offers.filter(o => o.status === s).length
            return (
              <div key={s} className={`tab ${statusTab === s ? 'active' : ''}`} onClick={() => setStatusTab(s)} style={{ textTransform: 'capitalize' }}>
                {s}{count > 0 && <span style={{ marginLeft: 5, background: s === 'pending' ? '#e6a817' : s === 'countered' ? '#b8965a' : s === 'accepted' ? '#2e7d32' : '#c62828', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>{count}</span>}
              </div>
            )
          })}
        </div>

        {loading
          ? <div className="loading-page" style={{ minHeight: 200 }}><div className="spinner" /></div>
          : offers.filter(o => o.status === statusTab).length === 0
            ? <div className="empty-state">No {statusTab} offers</div>
            : offers.filter(o => o.status === statusTab).map(offer => {
              const watch = offer.watches
              const thumb = getThumb(watch)
              return (
                <div key={offer.id} style={{ border: '1px solid #e8e5e0', borderRadius: 12, padding: 16, marginBottom: 12, background: '#fff' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div
                      onClick={() => navigate(`/catalog/${watch.id}`)}
                      style={{ width: 56, height: 56, borderRadius: 8, background: '#f7f6f3', border: '1px solid #e8e5e0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
                    >
                      {thumb
                        ? <img src={thumb} alt={watch.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 22 }}>⌚</span>
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
                          <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{fmtPrice(offer.offer_price)}</div>
                        </div>
                        {offer.counter_price && (
                          <div>
                            <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Counter offer</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#b8965a' }}>{fmtPrice(offer.counter_price)}</div>
                          </div>
                        )}
                      </div>

                      {offer.dealer_comment && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#555', background: '#f8f6f2', borderRadius: 6, padding: '6px 10px' }}>
                          <span style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Your note · </span>
                          {offer.dealer_comment}
                        </div>
                      )}
                      {offer.agent_comment && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#555', background: '#f0efe9', borderRadius: 6, padding: '6px 10px' }}>
                          <span style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Agent · </span>
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
    </div>
  )
}
