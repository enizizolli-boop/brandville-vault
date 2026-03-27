import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'

const WHATSAPP_NUMBER = process.env.REACT_APP_WHATSAPP_NUMBER || ''

export default function WatchDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [watch, setWatch] = useState(null)
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState('USD')
  const [reserving, setReserving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from('watches').select('*, watch_images(url, position), profiles!posted_by(full_name)').eq('id', id).single()
      if (data) {
        setWatch(data)
        setImages([...(data.watch_images || [])].sort((a, b) => a.position - b.position))
      }
      setLoading(false)
    }
    fetch()
  }, [id])

  async function handleReserve() {
    setReserving(true)
    const { error } = await supabase.from('watches').update({ status: 'reserved', reserved_by: profile.id }).eq('id', id)
    if (!error) { setWatch(w => ({ ...w, status: 'reserved' })); setMsg('Watch reserved successfully.') }
    setReserving(false)
  }

  async function handleUnreserve() {
    setReserving(true)
    const { error } = await supabase.from('watches').update({ status: 'available', reserved_by: null }).eq('id', id)
    if (!error) { setWatch(w => ({ ...w, status: 'available' })); setMsg('Watch is available again.') }
    setReserving(false)
  }

  function handleWhatsApp() {
    const price = currency === 'EUR' && watch.price_eur ? `€${Number(watch.price_eur).toLocaleString()}` : `$${Number(watch.price_usd).toLocaleString()}`
    const text = encodeURIComponent(`Hi, I'm interested in:\n*${watch.brand} ${watch.model}*\nRef: ${watch.reference || '—'}\nCondition: ${watch.condition}\nPrice: ${price}\n\nPlease confirm availability.`)
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, '_blank')
  }

  function handleShare() {
    const price = currency === 'EUR' && watch.price_eur ? `€${Number(watch.price_eur).toLocaleString()}` : `$${Number(watch.price_usd).toLocaleString()}`
    const text = `${watch.brand} ${watch.model}\nRef: ${watch.reference || '—'}\nCondition: ${watch.condition}\nPrice: ${price}\n${watch.notes ? `Notes: ${watch.notes}` : ''}`
    if (navigator.share) {
      navigator.share({ title: `${watch.brand} ${watch.model}`, text })
    } else {
      navigator.clipboard.writeText(text)
      setMsg('Watch details copied to clipboard.')
    }
  }

  if (loading) return <div className="loading-page"><div className="spinner" /></div>
  if (!watch) return <div className="loading-page">Watch not found.</div>

  const priceMain = currency === 'EUR' && watch.price_eur ? `€${Number(watch.price_eur).toLocaleString()}` : watch.price_usd ? `$${Number(watch.price_usd).toLocaleString()}` : '—'
  const priceSecondary = currency === 'EUR' && watch.price_usd ? `$${Number(watch.price_usd).toLocaleString()} USD` : currency === 'USD' && watch.price_eur ? `€${Number(watch.price_eur).toLocaleString()} EUR` : null

  return (
    <div className="page">
      <Topbar currency={currency} onCurrencyChange={setCurrency} />
      <div className="detail-page">
        <div className="back-btn" onClick={() => navigate(-1)}>← Back to catalog</div>
        {msg && <div className="success-msg">{msg}</div>}

        <div className="detail-images">
          {images.length > 0
            ? images.map((img, i) => <img key={i} src={img.url} alt={`${watch.model} ${i + 1}`} />)
            : <div className="no-img">⌚</div>
          }
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div className="detail-brand">{watch.brand}</div>
            <div className="detail-model">{watch.model}</div>
            <div className="detail-ref">{watch.reference || '—'}</div>
          </div>
          <span className={`badge badge-${watch.status}`} style={{ fontSize: 13, padding: '4px 10px' }}>{watch.status}</span>
        </div>

        <div className="detail-price">{priceMain}</div>
        {priceSecondary && <div className="detail-price-secondary">≈ {priceSecondary}</div>}

        <div className="detail-meta">
          <div className="detail-meta-row"><span>Condition</span><span>{watch.condition}</span></div>
          {watch.notes && <div className="detail-meta-row"><span>Notes</span><span>{watch.notes}</span></div>}
          <div className="detail-meta-row"><span>Posted by</span><span>{watch.profiles?.full_name || '—'}</span></div>
          <div className="detail-meta-row"><span>Posted</span><span>{new Date(watch.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
        </div>

        <div className="detail-actions">
          <button className="btn btn-green" onClick={handleWhatsApp} style={{ flex: 1 }}>WhatsApp inquiry</button>
          {watch.status === 'available'
            ? <button className="btn btn-warning" onClick={handleReserve} disabled={reserving} style={{ flex: 1 }}>{reserving ? '...' : 'Reserve'}</button>
            : watch.reserved_by === profile?.id || profile?.role === 'admin'
              ? <button className="btn" onClick={handleUnreserve} disabled={reserving} style={{ flex: 1 }}>{reserving ? '...' : 'Unreserve'}</button>
              : null
          }
          <button className="btn" onClick={handleShare} style={{ flex: 1 }}>Share</button>
        </div>
      </div>
    </div>
  )
}
